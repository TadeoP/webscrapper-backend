const express = require('express');
const puppeteer = require('puppeteer');
const XLSX = require('xlsx');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

async function scrapePage(page, searchQuery, pageNumber) {
  const url = `https://listado.mercadolibre.com.ar/${encodeURIComponent(searchQuery)}_Desde_${pageNumber}`;
  console.log(`Scraping página: ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ui-search-layout__item');

  const products = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.ui-search-layout__item'));
    return items.map(item => {
      const title = item.querySelector('a.poly-component__title')?.innerText || 'Sin título';
      const originalPriceText = item.querySelector('span.andes-money-amount__fraction')?.innerText || 'Sin precio original';
      const finalPriceText = item.querySelector('div.poly-price__current span.andes-money-amount__fraction')?.innerText || 'Sin precio final';
      const discountText = item.querySelector('span.andes-money-amount__discount')?.innerText || 'Sin descuento';
      const imageElement = item.querySelector('div.poly-card__portada img.poly-component__picture');
      const image = imageElement?.getAttribute('src') === 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
        ? imageElement?.getAttribute('data-src') || 'Sin imagen'
        : imageElement?.getAttribute('src') || 'Sin imagen';
      const link = item.querySelector('a.poly-component__title')?.href || 'Sin enlace';

      return { title, originalPrice: originalPriceText, finalPrice: finalPriceText, discount: discountText, image, link };
    });
  });

  return products;
}

async function scrapeMercadoLibre(searchQuery, maxPages = 5) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });    
  const page = await browser.newPage();
 
  const allProducts = [];
  let currentPage = 1;
  const itemsPerPage = 50;

  while (currentPage <= maxPages) {
    const pageNumber = (currentPage - 1) * itemsPerPage + 1;
    const products = await scrapePage(page, searchQuery, pageNumber);
    allProducts.push(...products);

    if (products.length < itemsPerPage) break;

    currentPage++;
  }

  await browser.close();
  return allProducts;
}

app.post('/scrape', async (req, res) => {
  const { product, pages } = req.body;

  try {
    const data = await scrapeMercadoLibre(product, pages);

    const rows = data.map(product => ({
      Título: product.title,
      'Precio Original': product.originalPrice,
      'Precio Final': product.finalPrice,
      Descuento: product.discount,
      Imagen: product.image,
      Enlace: product.link,
      " ": "", // Columna vacía para mantener los enlaces más cortos
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');

    const sanitizedQuery = product.replace(/ /g, '_');
    const filePath = path.join(__dirname, `${sanitizedQuery}.xlsx`);
    XLSX.writeFile(workbook, filePath);

    res.download(filePath, () => {
      fs.unlinkSync(filePath); // Elimina el archivo después de enviarlo
    });
  } catch (error) {
    console.error('Error al realizar el scraping:', error);
    res.status(500).send('Error al realizar el scraping');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
