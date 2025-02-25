import { Router } from 'itty-router'
import { Redis } from '@upstash/redis/cloudflare'

import { urlSaveForm, homePage } from './templates'
import { rawHtmlResponse, readRequestBody } from './functions'

// Create a new router
const router = Router()
const redis = Redis.fromEnv()

/*
Index route - Landing page
*/
router.get('/', () => {
    return rawHtmlResponse(homePage)
})

/*
Admin route - URL form
*/
router.get('/admin', async () => {
    return rawHtmlResponse(urlSaveForm)
})

/*
API route to return all keys and values in Redis
*/
router.get('/admin/urls', async () => {
    const keys = await redis.keys('*')
    // For each key get value
    const values = await Promise.all(
        keys.map(async key => {
            let value = await redis.get(key)
            return { key, value }
        })
    )
    return rawHtmlResponse(JSON.stringify(values))
})

router.get('/s/:url', async request => {
    console.log('START')

    try {
        // 1. Get value from Redis
        const value = await redis.get(request.params.url)

        if (!value) {
            return new Response('Not found', { status: 404 })
        }

        // 2. Prepare Kafka message
        const message = {
            shortCode: request.params.url,
            longUrl: value,
            country: request.cf?.country || 'unknown',
            city: request.cf?.city || 'unknown',
            ip: request.headers.get('cf-connecting-ip') || 'unknown',
        }

        // 3. Send to Kafka REST Proxy with timeout
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)

        try {
            const kafkaResponse = await fetch(
                'https://kafka.levantisk.com:8082/topics/visits-log', // Use HTTPS
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/vnd.kafka.json.v2+json',
                        Accept: 'application/vnd.kafka.v2+json',
                    },
                    body: JSON.stringify({
                        records: [
                            {
                                value: message,
                            },
                        ],
                    }),
                    signal: controller.signal,
                }
            )

            clearTimeout(timeout)

            if (!kafkaResponse.ok) {
                const errorBody = await kafkaResponse.text()
                console.error('Kafka Error:', errorBody)
            }
        } catch (err) {
            console.error('Kafka Connection Error:', err.message)
        }

        // 4. Redirect regardless of Kafka success
        return new Response(null, {
            status: 302,
            headers: {
                Location: value,
            },
        })
    } catch (err) {
        console.error('Unhandled Error:', err)
        return new Response('Internal Server Error', { status: 500 })
    }
})
/*
Save route - Save URL to Upstash Redis
*/
router.post('/admin/store', async request => {
    const reqBody = await readRequestBody(request)
    const body = await JSON.parse(reqBody)

    try {
        //const data = await redis.set('urls', '{ "longUrl": "' + body.longUrl + '" , "shortCode": "' + body.shortCode + '" }');
        const data = await redis.set(body.shortCode, body.longUrl)
        console.log(data)
        // Redirect to /admin
        return new Response('', {
            status: 302,
            headers: { Location: '/admin' },
        })
    } catch (error) {
        return new Response(error)
    }
})

/*
This is the last route we define, it will match anything that hasn't hit a route we've defined
above, therefore it's useful as a 404 (and avoids us hitting worker exceptions, so make sure to include it!).

Visit any page that doesn't exist (e.g. /foobar) to see it in action.
*/
router.all('*', () => new Response('404, not found!', { status: 404 }))

/*
This snippet ties our worker to the router we deifned above, all incoming requests
are passed to the router where your routes are called and the response is sent.
*/
addEventListener('fetch', e => {
    e.respondWith(router.handle(e.request))
})
