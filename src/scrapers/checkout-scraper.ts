import * as cheerio from 'cheerio';

/**
 * Interface for checkout order item
 */
export interface CheckoutOrderItem {
    title: string;
    quantity: number;
    price: number;
    currency: string;
    imageUrl?: string | null;
    sku?: string | null;
}

/**
 * Interface for Alibaba checkout/order data
 */
export interface AlibabaCheckout {
    orderNumber: string | null;
    subtotal: number | null;
    currency: string;
    items: CheckoutOrderItem[];
    itemCount: number;
    checkoutUrl: string | null;
    paymentMethods?: string[];
}

/**
 * Scrapes Alibaba checkout/cashier page HTML and extracts order details
 */
export class CheckoutScraper {
    private $: cheerio.CheerioAPI;

    constructor(html: string) {
        this.$ = cheerio.load(html) as unknown as cheerio.CheerioAPI;
    }

    /**
     * Extract order number
     */
    private extractOrderNumber(): string | null {
        const $ = this.$;

        // Look for order number in various formats
        // Pattern: "Order No. #15637752501043466" or "Order #15637752501043466"
        const bodyText = $('body').text();

        // Try multiple patterns
        const orderPatterns = [
            /Order\s*(?:No\.?|Number)?\s*#?\s*(\d{10,})/i,
            /Order\s*#\s*(\d{10,})/i,
            /#\s*(\d{10,})/i, // Just a number with # prefix
            /Order\s*ID[:\s]*(\d{10,})/i,
        ];

        for (const pattern of orderPatterns) {
            const match = bodyText.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }

        // Try to find in specific elements
        const orderSelectors = [
            '[class*="order-number"]',
            '[class*="order-no"]',
            '[data-testid*="order"]',
            '.order-info',
            '[id*="order"]',
        ];

        for (const selector of orderSelectors) {
            const elements = $(selector);
            for (let i = 0; i < elements.length; i++) {
                const text = $(elements[i]).text().trim();
                // Look for long numeric strings (order numbers are typically 10+ digits)
                const match = text.match(/#?\s*(\d{10,})/);
                if (match && match[1]) {
                    return match[1];
                }
            }
        }

        return null;
    }

    /**
     * Extract currency from the page
     */
    private extractCurrency(): string {
        const $ = this.$;
        const bodyText = $('body').text();

        // Look for currency symbols or codes
        if (bodyText.includes('USD') || bodyText.includes('US$') || bodyText.includes('$')) {
            return 'USD';
        } else if (bodyText.includes('EUR') || bodyText.includes('€')) {
            return 'EUR';
        } else if (bodyText.includes('GBP') || bodyText.includes('£')) {
            return 'GBP';
        } else if (bodyText.includes('CNY') || bodyText.includes('¥')) {
            return 'CNY';
        } else if (bodyText.includes('NGN') || bodyText.includes('₦')) {
            return 'NGN';
        } else if (bodyText.includes('GHS') || bodyText.includes('GH₵')) {
            return 'GHS';
        }

        // Default to USD
        return 'USD';
    }

    /**
     * Extract subtotal/total amount
     */
    private extractSubtotal(currency: string): number | null {
        const $ = this.$;

        // Look for "Subtotal:" followed by amount
        const bodyText = $('body').text();

        // Pattern: "Subtotal: USD 979.00" or "Subtotal: $979.00" or "Subtotal: 979.00"
        // Also try "Payment summary" section
        const subtotalPatterns = [
            new RegExp(`Subtotal[\\s:]*${currency}[\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
            new RegExp(`Subtotal[\\s:]*[\\$€£¥₦]?[\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
            new RegExp(`Total[\\s:]*${currency}[\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
            new RegExp(`Total[\\s:]*[\\$€£¥₦]?[\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
            new RegExp(`Payment[\\s]+summary[\\s]*[\\s\\S]{0,200}?${currency}[\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
            new RegExp(`Payment[\\s]+summary[\\s]*[\\s\\S]{0,200}?[\\$€£¥₦]?[\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
        ];

        for (const pattern of subtotalPatterns) {
            const match = bodyText.match(pattern);
            if (match && match[1]) {
                const amount = parseFloat(match[1].replace(/,/g, ''));
                if (!isNaN(amount) && amount > 0) {
                    return amount;
                }
            }
        }

        // Try to find in specific elements - look for payment summary section first
        // The payment summary section contains the final total with processing fees
        const paymentSummarySelectors = [
            '.checkoutV4-summary-ui-wrapper-container',
            '[class*="payment-summary"]',
            '.checkout-v4-payment-summary',
        ];

        // First, try to get the final total from payment summary (includes processing fees)
        for (const selector of paymentSummarySelectors) {
            const summaryContainer = $(selector);
            if (summaryContainer.length > 0) {
                // Look for the final total amount (usually in .summary-detail.primary)
                const finalTotalElement = summaryContainer.find('.summary-detail.primary .value, .summary-detail.overlap.primary .value');
                if (finalTotalElement.length > 0) {
                    const totalText = finalTotalElement.text().trim();
                    // Extract amount from text like "USD 1,008.28"
                    const totalMatch = totalText.match(/(?:USD|EUR|GBP|CNY|NGN|GHS)[\s]*([\d,]+(?:\.\d+)?)/i) ||
                        totalText.match(/[\$€£¥₦][\s]*([\d,]+(?:\.\d+)?)/);
                    if (totalMatch && totalMatch[1]) {
                        const amount = parseFloat(totalMatch[1].replace(/,/g, ''));
                        if (!isNaN(amount) && amount > 0) {
                            // This is the final total including processing fees
                            return amount;
                        }
                    }
                }

                // Also try to find "Pay in" total (this is the final amount with fees)
                const payInElement = summaryContainer.find('[id="cashier-currency-parent"] .value, .currency-list-wrapper-ui + .value');
                if (payInElement.length > 0) {
                    const payInText = payInElement.text().trim();
                    const payInMatch = payInText.match(/(?:USD|EUR|GBP|CNY|NGN|GHS)[\s]*([\d,]+(?:\.\d+)?)/i) ||
                        payInText.match(/[\$€£¥₦][\s]*([\d,]+(?:\.\d+)?)/);
                    if (payInMatch && payInMatch[1]) {
                        const amount = parseFloat(payInMatch[1].replace(/,/g, ''));
                        if (!isNaN(amount) && amount > 0) {
                            // This is the final total including processing fees
                            return amount;
                        }
                    }
                }
            }
        }

        // Fallback to other selectors
        const subtotalSelectors = [
            '[class*="order-summary"]',
            '[class*="subtotal"]',
            '[class*="total"]',
            '[data-testid*="subtotal"]',
            '[data-testid*="total"]',
            '[class*="summary"]',
        ];

        for (const selector of subtotalSelectors) {
            const elements = $(selector);
            for (let i = 0; i < elements.length; i++) {
                const text = $(elements[i]).text().trim();
                // Look for currency followed by number (most common format)
                const patterns = [
                    new RegExp(`${currency}[\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
                    new RegExp(`[\\$€£¥₦][\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
                    new RegExp(`([\\d,]+(?:\\.[\\d]+)?)[\\s]*${currency}`, 'i'),
                ];

                for (const pattern of patterns) {
                    const match = text.match(pattern);
                    if (match && match[1]) {
                        const amount = parseFloat(match[1].replace(/,/g, ''));
                        if (!isNaN(amount) && amount > 0 && amount < 10000000) {
                            return amount;
                        }
                    }
                }
            }
        }

        // Last resort: look for any large number that could be a total
        // This is less reliable but might catch edge cases
        const allNumbers = bodyText.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g);
        if (allNumbers) {
            // Filter for reasonable totals (between 1 and 10,000,000)
            const candidates = allNumbers
                .map(n => parseFloat(n.replace(/,/g, '')))
                .filter(n => !isNaN(n) && n >= 1 && n < 10000000)
                .sort((a, b) => b - a); // Sort descending

            // Return the largest reasonable number (likely the total)
            if (candidates.length > 0) {
                return candidates[0];
            }
        }

        return null;
    }

    /**
     * Extract order items
     */
    private extractItems(currency: string): CheckoutOrderItem[] {
        const $ = this.$;
        const items: CheckoutOrderItem[] = [];

        // Look for product/item containers
        const itemSelectors = [
            '[class*="product-item"]',
            '[class*="order-item"]',
            '[class*="cart-item"]',
            '[data-testid*="product"]',
            '[data-testid*="item"]',
            '.order-product',
            '.checkout-item',
        ];

        // Try to find item count first
        const bodyText = $('body').text();
        const itemCountMatch = bodyText.match(/(\d+)\s*product\(s\)/i);
        const expectedItemCount = itemCountMatch ? parseInt(itemCountMatch[1]) : null;

        // Look for items in various structures
        for (const selector of itemSelectors) {
            const elements = $(selector);

            if (elements.length > 0) {
                elements.each((_, el) => {
                    const $item = $(el);

                    // Extract title
                    const titleSelectors = [
                        '[class*="title"]',
                        '[class*="name"]',
                        'h3', 'h4', 'h5',
                        'a[href*="product"]',
                    ];

                    let title: string | null = null;
                    for (const titleSel of titleSelectors) {
                        const titleEl = $item.find(titleSel).first();
                        if (titleEl.length > 0) {
                            title = titleEl.text().trim() || titleEl.attr('title') || null;
                            if (title && title.length > 3) break;
                        }
                    }

                    // Extract quantity
                    let quantity = 1;
                    const qtyText = $item.text();
                    const qtyMatch = qtyText.match(/Qty[:\s]*(\d+)/i) || qtyText.match(/Quantity[:\s]*(\d+)/i);
                    if (qtyMatch) {
                        quantity = parseInt(qtyMatch[1]);
                    }

                    // Extract price
                    let price: number | null = null;
                    const priceText = $item.text();
                    const pricePatterns = [
                        new RegExp(`${currency}[\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
                        new RegExp(`[\\$€£¥₦][\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
                    ];

                    for (const pattern of pricePatterns) {
                        const match = priceText.match(pattern);
                        if (match) {
                            price = parseFloat(match[1].replace(/,/g, ''));
                            if (!isNaN(price) && price > 0) break;
                        }
                    }

                    // Extract image
                    let imageUrl: string | null = null;
                    const img = $item.find('img').first();
                    if (img.length > 0) {
                        imageUrl = img.attr('src') || img.attr('data-src') || img.attr('data-lazy') || null;
                        if (imageUrl && imageUrl.startsWith('//')) {
                            imageUrl = 'https:' + imageUrl;
                        }
                    }

                    // Extract SKU if available
                    let sku: string | null = null;
                    const skuText = $item.text();
                    const skuMatch = skuText.match(/SKU[:\s]*([A-Z0-9-]+)/i);
                    if (skuMatch) {
                        sku = skuMatch[1];
                    }

                    if (title && price !== null) {
                        items.push({
                            title,
                            quantity,
                            price,
                            currency,
                            imageUrl,
                            sku,
                        });
                    }
                });

                if (items.length > 0) break;
            }
        }

        // If we found expected item count but fewer items, try alternative extraction
        if (expectedItemCount && items.length < expectedItemCount) {
            // Try to extract from text patterns
            // This is a fallback for when items are listed in text format
            const itemTextPattern = new RegExp(
                `([^\\n]{10,100})\\s*(?:Qty[:\s]*)?(\\d+)?\\s*(?:${currency}[\\s]*)?([\\d,]+(?:\\.[\\d]+)?)`,
                'gi'
            );

            let match;
            while ((match = itemTextPattern.exec(bodyText)) !== null && items.length < expectedItemCount) {
                const title = match[1].trim();
                const qty = match[2] ? parseInt(match[2]) : 1;
                const price = parseFloat(match[3].replace(/,/g, ''));

                if (title.length > 3 && !isNaN(price) && price > 0) {
                    // Check if we already have this item
                    if (!items.some(item => item.title === title)) {
                        items.push({
                            title,
                            quantity: qty,
                            price,
                            currency,
                            imageUrl: null,
                            sku: null,
                        });
                    }
                }
            }
        }

        return items;
    }

    /**
     * Extract payment methods
     */
    private extractPaymentMethods(): string[] {
        const $ = this.$;
        const methods: string[] = [];

        // Look for payment method indicators
        const paymentSelectors = [
            '[class*="payment-method"]',
            '[class*="pay-method"]',
            '[data-testid*="payment"]',
        ];

        const bodyText = $('body').text().toLowerCase();

        // Common payment methods
        const paymentKeywords = [
            'paypal', 'visa', 'mastercard', 'amex', 'apple pay', 'google pay',
            'wire transfer', 'bank transfer', 'alipay', 'wechat pay',
        ];

        for (const keyword of paymentKeywords) {
            if (bodyText.includes(keyword.toLowerCase())) {
                methods.push(keyword);
            }
        }

        return methods;
    }

    /**
     * Scrape all checkout data
     */
    public scrape(): AlibabaCheckout {
        const currency = this.extractCurrency();
        const orderNumber = this.extractOrderNumber();
        const subtotal = this.extractSubtotal(currency);
        const items = this.extractItems(currency);
        const paymentMethods = this.extractPaymentMethods();

        return {
            orderNumber,
            subtotal,
            currency,
            items,
            itemCount: items.length,
            checkoutUrl: null, // Will be set externally
            paymentMethods: paymentMethods.length > 0 ? paymentMethods : undefined,
        };
    }
}

/**
 * Scrape Alibaba checkout page from HTML
 */
export function scrapeCheckoutFromHtml(html: string): AlibabaCheckout {
    const scraper = new CheckoutScraper(html);
    return scraper.scrape();
}
