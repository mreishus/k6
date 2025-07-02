import http from 'k6/http'
import { Rate, Trend } from 'k6/metrics'
import { check, group, fail, sleep } from 'k6'

import Metrics from './lib/metrics.js';
import { isOK, itemAddedToCart, cartHasProduct, cartAPIHasProduct, orderAPIWasPlaced } from './lib/checks.js'
import { rand, sample, validateSiteUrl, responseWasCached, bypassPageCacheCookies } from './lib/helpers.js'

import faker from 'https://cdn.jsdelivr.net/npm/faker@5.5.3/dist/faker.min.js'

export const options = {
    throw: true,
    summaryTimeUnit: 'ms',
    scenarios: {
        ramping: {
            executor: 'ramping-vus',
            startVUs: 1,
            gracefulStop: '10s',
            gracefulRampDown: '10s',
            stages: [
                { duration: '1m', target: 100 },
            ],
        },
        // constant: {
        //     executor: 'constant-vus',
        //     vus: 100,
        //     duration: '1m',
        //     gracefulStop: '10s',
        // },
    },
    ext: {
        loadimpact: {
            name: 'WooCommerce checkout flow',
            note: 'Loads the homepage, selects and loads a random category, selects a random product and adds it to the cart, loads the cart page and then places an order.',
            projectID: __ENV.PROJECT_ID || null
        },
    },
}

const errorRate = new Rate('errors')
const responseCacheRate = new Rate('response_cached')

// These metrics are provided by Object Cache Pro when `analytics.footnote` is enabled
const metrics = new Metrics();

export function setup () {
    return {
        startedAt: Date.now(),
    }
}

export function teardown (data) {
    const startedAt = new Date(data.startedAt)
    const endedAt = new Date()

    console.info(`Run started at ${startedAt.toJSON()}`)
    console.info(`Run ended at   ${endedAt.toJSON()}`)
}

export default function () {
    const jar = new http.CookieJar()
    const siteUrl = __ENV.SITE_URL

    validateSiteUrl(siteUrl);

    const pause = {
        min: 3,
        max: 8,
    }

    if (__ENV.BYPASS_CACHE) {
        Object.entries(bypassPageCacheCookies()).forEach(([key, value]) => {
            jar.set(siteUrl, key, value, { path: '/' })
        })
    }

    const categories = group('Load homepage', function () {
        const response = http.get(siteUrl, { jar })

        check(response, isOK)
            || (errorRate.add(1) && fail('status code was *not* 200'))

        metrics.addResponseMetrics(response)
        responseCacheRate.add(responseWasCached(response))

        return response.html()
            .find('li.product-category > a')
            .map((idx, el) => String(el.attr('href')))
            .filter(href => ! href.includes('/decor/')) // skip WP swag
    })

    sleep(rand(pause.min, pause.max))

    const products = group('Load category', function () {
        const category = sample(categories)
        const response = http.get(category, { jar })

        check(response, isOK)
            || (errorRate.add(1) && fail('status code was *not* 200'))

        metrics.addResponseMetrics(response)
        responseCacheRate.add(responseWasCached(response))

        const products = response.html()
            .find('.products, ul.wc-block-product-template__responsive')
            .find('li:not(.product-type-variable):not(.outofstock)')
            .find('a[href*="/product/"]')
            .map((idx, el) => el.attr('href'));

        if (!products.length) {
            fail(`No product links found on ${category} - check selector or product visibility`);
        }
        return products
    })

    sleep(rand(pause.min, pause.max))

    group('Load and add product to cart', function () {
        const product = sample(products)
        const response = http.get(product, { jar })

        check(response, isOK)
            || (errorRate.add(1) && fail('status code was *not* 200'))

        metrics.addResponseMetrics(response)
        responseCacheRate.add(responseWasCached(response))

        const fields = response.html()
            .find('.input-text.qty')
            .map((idx, el) => el.attr('name'))
            .reduce((obj, key) => {
                obj[key] = 1

                return obj
            }, {})

        const formResponse = response.submitForm({
            formSelector: 'form.cart',
            fields,
            params: { jar },
        })

        check(formResponse, isOK)
            || (errorRate.add(1) && fail('status code was *not* 200'))

        check(formResponse, itemAddedToCart)
            || fail('items *not* added to cart')

        metrics.addResponseMetrics(formResponse)
        responseCacheRate.add(responseWasCached(formResponse))
    })

    sleep(rand(pause.min, pause.max))

    group('Load cart (Store API)', function () {
        const response = http.get(
            `${siteUrl}/wp-json/wc/store/cart`,
            {
                jar,
                headers: { 'accept': 'application/json' },
            },
        );

        check(response, isOK)
            || (errorRate.add(1) && fail('status code was *not* 200'));

        check(response, cartAPIHasProduct)
            || fail('cart was empty');

        metrics.addResponseMetrics(response);
        responseCacheRate.add(responseWasCached(response));
    });

    sleep(rand(pause.min, pause.max));

    group('Place order (Store API)', function () {
        const cartRes = http.get(`${siteUrl}/wp-json/wc/store/cart`, {
            jar,
            headers: { accept: 'application/json' },
        });

        const nonce     = cartRes.headers['Nonce'];
        const cartToken = cartRes.headers['Cart-Token'];

        check(cartRes, isOK)
            || (errorRate.add(1) && fail('could not fetch Store API nonce'));

        if (!nonce) {
            errorRate.add(1);
            fail('Store API nonce was not returned');
        }
        if (!cartToken) {
            errorRate.add(1);
            fail('Cart-Token header missing. check WC version/config');
        }

        const first = faker.name.firstName() + rand(1, 9999);
        const last  = faker.name.lastName() + rand(1, 9999);
        const billing = {
            first_name: first,
            last_name:  last,
            address_1:  faker.address.streetAddress(),
            city:       faker.address.city(),
            state:      faker.address.stateAbbr(),
            postcode:   faker.address.zipCodeByState('DE'),
            country:    'US',
            email:      faker.internet.exampleEmail(first, last),
            phone:      faker.phone.phoneNumberFormat(),
        };
        const payload = JSON.stringify({
            billing_address: billing,
            shipping_address: { ...billing },
            payment_method: 'cod', // Enable cash on delivery in /wp-admin/admin.php?page=wc-settings&tab=checkout
        });

        const checkoutRes = http.post(
            `${siteUrl}/wp-json/wc/store/checkout`,
            payload,
            {
                jar,
                headers: {
                    'content-type': 'application/json',
                    'accept':       'application/json',
                    'Nonce':        nonce,
                    'Cart-Token':   cartToken,
                },
            },
        );

        if (!check(checkoutRes, isOK)) {
            errorRate.add(1);
            console.log(checkoutRes);
            fail('checkout call did not return 200');
        }

        check(checkoutRes, orderAPIWasPlaced)
            || fail('order was *not* placed');

        metrics.addResponseMetrics(checkoutRes);
        responseCacheRate.add(responseWasCached(checkoutRes));
    });
}
