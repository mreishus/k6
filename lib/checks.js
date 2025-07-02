
export const isOK = {
    'response code is 200': response => response.status == 200
}

export const itemAddedToCart = {
    'item added to cart': response => {
        return response.cookies.woocommerce_items_in_cart
            && response.cookies.woocommerce_items_in_cart.find(cookie => cookie.value > 0)
    }
}

export const cartHasProduct = {
    'cart has product': response => response.html().find('.woocommerce-cart-form').size() === 1
}

export const orderWasPlaced = {
    'order was placed': response => response.url.includes('/checkout/order-received/'),
}

export const pageIsNotLogin = {
    'page is not login': response => {
        return response.html().find('button[name="login"]').size() === 0
            && response.html().find('input[name="password"]').size() === 0
    }
}

export const cartAPIHasProduct = {
    'cart API has product': response => {
        try {
            const data = response.json();
            return Array.isArray(data.items) && data.items.length > 0;
        } catch (_) {
            // Response was not JSON.
            return false;
        }
    }
};

export const orderAPIWasPlaced = {
    'order was placed': res => {
        try {
            const data = res.json();
            return (
                typeof data.order_id === 'number' &&
                data.order_id > 0 &&
                data.payment_result &&
                /\/checkout\/order-received\//.test(
                    data.payment_result.redirect_url || ''
                )
            );
        } catch (_) {
            // Response was not json.
            return false;
        }
    },
}

