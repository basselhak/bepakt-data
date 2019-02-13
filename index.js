const fs = require('fs')
const path = require('path')
const util = require('util')
const writeFile = util.promisify(fs.writeFile)
const readdir = util.promisify(fs.readdir)
const unlink = util.promisify(fs.unlink)
const csv = require('csvtojson')
const cheerio = require('cheerio')
const chrono = require('chrono-node')
const winston = require('winston')
const request = require('superagent')
const uuidv4 = require('uuid/v4')
const prefix = require('superagent-prefix')('http://bepakt.com/')
const { URL } = require('url')
const moment = require('moment')
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console()
  ]
})

const AJV = require('ajv')

const ajv = new AJV({ allErrors: true })

const { Location } = require('@zerowastemap/schemas/location')

Promise.all([
  clean(path.join(__dirname, './assets')),
  setCrowdfundings(),
  setLocations()
])
.catch(err => {
  console.error(err)
})

async function clean (directory) {
  const files = await readdir(directory)
  const unlinkPromises = files.map(filename => unlink(`${directory}/${filename}`))
  return Promise.all(unlinkPromises)
}

async function getItems (path) {
  const items = await csv()
    .fromFile(path)

  return items
}

async function setLocations () {
  const profiler = logger.startTimer()
  logger.info('setting locations')
  const items = await getItems(path.join(__dirname, './tables/2-Supermarkets-2019-02-07.csv'))
  const data = await Promise.all(items.map(async function (item) {
    const obj = {}
    const $shop = cheerio.load(item.Shop)
    let name = $shop('a').text()
    const url = cheerio.load(item.Location)('a').attr('href')

    const $contact = cheerio.load(item['Contact'])
    const contact = $contact('a').map(function (i, el) {
      return $contact(this).text()
    }).get().filter(Boolean)
    let lat = 0
    let long = 0

    const src = $shop('img').attr('src')
    const filename = uuidv4()

    if (src) {
      const imageUrl = new URL(src)
      const res = await request
        .get(imageUrl.pathname)
        .use(prefix)
      await writeFile(path.join(__dirname, `./assets/${filename}`), res.body)
    }

    if (url) {
      const coords = url.match(new RegExp('@(.*?),(.*?),'))
      if (coords) {
        long = parseFloat(coords[1], 10) || 0
        lat = parseFloat(coords[2], 10) || 0
      }
    }

    obj.image = {
      src: `https://static.zerowastemap.app/file/zerowastemap/${filename}`,
      uuid: filename
    }
    obj.name = decodeURIComponent(JSON.parse('"' + name.replace(/\n/g, ' ').trim() + '"'))
    obj.geometry = {
      coordinates: [long, lat],
      type: 'Point'
    }
    obj.meta = {
      contact
    }

    const openingDate = chrono.parseDate(item['Open Since'])

    if (openingDate) {
      obj.meta.openingDate = moment(openingDate).format('YYYY-MM-DD')
    }

    const isValid = ajv.validate(Location, Object.assign(obj, { address: {
      zip: 'B1000',
      countryCode: 'BE'
    }}))

    if (!isValid) {
      for (let error of ajv.errors) {
        logger.error({
          obj,
          ajv: error
        })
      }
    } else {
      return obj
    }
  }))
  profiler.done({ message: 'Done parsing locations' })
  await writeFile(path.join(__dirname, './json/data-locations.json'), JSON.stringify(data, null, 4))
  profiler.done({ message: 'Writed location file' })
}

/*
async function uploadImages () {

}

async function saveLocations () {

}
*/

async function setCrowdfundings () {
  const profiler = logger.startTimer()
  logger.info('setting crowdfundings')
  const items = await getItems(path.join(__dirname, './tables/1-Crowdfundings-2019-02-07.csv'))
  const data = items.map(item => {
    let name = cheerio.load(item.Shop)('a').text()
    name = decodeURIComponent(JSON.parse('"' + name.replace(/\n/g, ' ').trim() + '"'))
    const $ = cheerio.load(`<div>${item.Location}</div>`)
    const $elems = $('div').contents().filter(function () {
      return this.nodeType === 3
    })
    const arr = []
    $elems.each(function () {
      arr.push($(this).text())
    })
    return {
      name,
      address: arr.map((item) => item.split()).join(' ').replace(/\s\s+/g, ' ')
    }
  })

  profiler.done({ message: 'Done parsing crowdfundings' })

  await writeFile(path.join(__dirname, './json/data-crowdfundings.json'), JSON.stringify(data, null, 4))

  profiler.done({ message: 'Writed crowdfunding file' })
}
