# k6

We use these scripts to benchmark Object Cache Pro and Relay with various hosting partners.

## FORK README

**July 2025**
Added `woo-checkout-block.js` for testing WooCommerce stores using block themes and the Store API. This script maintains the same test flow as `woo-checkout.js` but uses modern WooCommerce APIs and selectors.
Small updates to the "Reset WooCommerce" commands.

## Setup

Make sure [k6 is installed](https://k6.io/docs/getting-started/installation/).

All tests can be run locally using `k6 run` or in the cloud using `k6 cloud`. 

When Object Cache Pro is installed, custom metrics for [WordPress, Redis and Relay](lib/metrics.js) are automatically collected. 

## Tests

### `wp.js`

Fetches all WordPress sitemaps and requests random URLs.

```
k6 run wp.js --env SITE_URL=https://example.com
k6 run wp.js --vus=100 --duration=10m --env SITE_URL=https://example.com
```

### `woo-checkout.js`

Loads the homepage, selects and loads a random category, selects a random product and adds it to the cart, loads the cart page and then places an order.

```
wp option update woocommerce_enable_guest_checkout no --autoload=no
wp option update woocommerce_enable_signup_and_login_from_checkout yes --autoload=no

k6 run woo-checkout.js --env SITE_URL=https://example.com
```

Be sure to [reset WooCommerce](#reset-woocommerce) between test runs.

### `woo-checkout-block.js`

Loads the homepage, selects and loads a random category, selects a random product and adds it to the cart, loads the cart page and then places an order.

This is the same as woo-checkout-block, but updated for block themes.
- Updated product selector to support both classic (`.products`) and block-based product grids (`ul.wc-block-product-template__responsive`)
- Uses the WooCommerce Store API (`/wp-json/wc/store/`) for cart and checkout operations instead of form submissions
  - I was having trouble getting the methods used in woo-checkout.js to work, I suspect because we now need JS/XHR hydration.
- Requires Cash on Delivery payment method to be enabled in WooCommerce settings.

If there are nil URL errors on your site early in the process, try adding a `[product_categories]` shortcode on your homepage.

```
wp option update woocommerce_enable_guest_checkout no --autoload=no
wp option update woocommerce_enable_signup_and_login_from_checkout yes --autoload=no

k6 run woo-checkout.js --env SITE_URL=https://example.com
```

Be sure to [reset WooCommerce](#reset-woocommerce) between test runs.

### `woo-customer.js`

Loads the homepage, signs in, views at orders and then their account details.

```
k6 run woo-customer.js --env SITE_URL=https://example.com
```

This script requires [seeded users](#seeding-users).

## Environment variables

### Site URL

You can pass in the `SITE_URL` to point the traffic at at specific URL.

```
k6 run wp.js --env SITE_URL=https://example.com
```

### Project ID

You can set the k6 Cloud "Project ID" using the `PROJECT_ID` environment variable.

```
k6 cloud wp.js --env PROJECT_ID=123456 --env SITE_URL=https://example.com
```

### Bypass page caches

To attempt bypassing page caches without logging in, pass in `BYPASS_CACHE`:

```
k6 run wp.js --env BYPASS_CACHE=1
```

## Reset WooCommerce (when HPOS is enabled)

```
wp db query "TRUNCATE TABLE wp_wc_orders"
wp db query "TRUNCATE TABLE wp_wc_orders_meta"
wp db query "TRUNCATE TABLE wp_wc_order_addresses"
wp db query "TRUNCATE TABLE wp_wc_order_operational_data"
wp user delete --yes $(wp user list --role=customer --field=ID --posts_per_page=-1)
wp cache flush
```


## Reset WooCommerce (when HPOS is disabled)

```
wp post delete --force $(wp post list --post_type=shop_order --field=ID --posts_per_page=-1)
wp user delete --yes $(wp user list --role=customer --field=ID --posts_per_page=-1)
wp cache flush
```

## Seeding users

Load tests that run with logged in users, use this seed command to create 100 users:

```
for USR_NO in {1..100}; do wp user create "test${USR_NO}" "test${USR_NO}@example.com" --role=subscriber --user_pass=3405691582; done;
```
