import * as cheerio from 'cheerio';

/**
 * Interface for payment breakdown details
 */
export interface PaymentBreakdown {
    orderAmount: number; // Order amount before fees
    processingFee: number; // Payment processing fee
    total: number; // Final total (orderAmount + processingFee)
}

/**
 * Interface for checkout order item (single item representing the entire order)
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
    subtotal: number | null; // Final total amount
    currency: string;
    paymentBreakdown?: PaymentBreakdown; // Payment details breakdown
    items: CheckoutOrderItem[]; // Single item representing the order
    itemCount: number; // Number of products in the order
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

        // Look for currency symbols or codes in payment summary
        const paymentSummary = $('.checkoutV4-summary-ui-wrapper-container, .checkoutV4-summary-ui-wrapper');
        if (paymentSummary.length > 0) {
            const summaryText = paymentSummary.text();
            if (summaryText.includes('EUR') || summaryText.includes('€')) {
                return 'EUR';
            } else if (summaryText.includes('USD') || summaryText.includes('US$') || summaryText.includes('$')) {
                return 'USD';
            } else if (summaryText.includes('GBP') || summaryText.includes('£')) {
                return 'GBP';
            } else if (summaryText.includes('CNY') || summaryText.includes('¥')) {
                return 'CNY';
            } else if (summaryText.includes('NGN') || summaryText.includes('₦')) {
                return 'NGN';
            } else if (summaryText.includes('GHS') || summaryText.includes('GH₵')) {
                return 'GHS';
            }
        }

        // Look in body text as fallback
        if (bodyText.includes('EUR') || bodyText.includes('€')) {
            return 'EUR';
        } else if (bodyText.includes('USD') || bodyText.includes('US$') || bodyText.includes('$')) {
            return 'USD';
        } else if (bodyText.includes('GBP') || bodyText.includes('£')) {
            return 'GBP';
        } else if (bodyText.includes('CNY') || bodyText.includes('¥')) {
            return 'CNY';
        } else if (bodyText.includes('NGN') || bodyText.includes('₦')) {
            return 'NGN';
        } else if (bodyText.includes('GHS') || bodyText.includes('GH₵')) {
            return 'GHS';
        }

        // Default to EUR (as per user requirement)
        return 'EUR';
    }

    /**
     * Extract payment breakdown from payment summary section
     */
    private extractPaymentBreakdown(currency: string): PaymentBreakdown | null {
        const $ = this.$;

        // Look for payment summary container
        const paymentSummary = $('.checkoutV4-summary-ui-wrapper-container, .checkoutV4-summary-ui-wrapper');

        if (paymentSummary.length === 0) {
            return null;
        }

        let orderAmount: number | null = null;
        let processingFee: number | null = null;
        let total: number | null = null;

        // Extract order amount (first summary-detail that's not primary)
        const orderAmountRow = paymentSummary.find('.summary-detail:not(.primary):not(.overlap)').first();
        if (orderAmountRow.length > 0) {
            const orderAmountText = orderAmountRow.find('.value').text().trim();
            const orderMatch = orderAmountText.match(/(?:USD|EUR|GBP|CNY|NGN|GHS)[\s]*([\d,]+(?:\.\d+)?)/i) ||
                orderAmountText.match(/[\$€£¥₦][\s]*([\d,]+(?:\.\d+)?)/);
            if (orderMatch && orderMatch[1]) {
                orderAmount = parseFloat(orderMatch[1].replace(/,/g, ''));
            }
        }

        // Extract payment processing fee
        const processingFeeRow = paymentSummary.find('.summary-detail:not(.primary):not(.overlap)').eq(1);
        if (processingFeeRow.length > 0) {
            const feeText = processingFeeRow.find('.value').text().trim();
            const feeMatch = feeText.match(/(?:USD|EUR|GBP|CNY|NGN|GHS)[\s]*([\d,]+(?:\.\d+)?)/i) ||
                feeText.match(/[\$€£¥₦][\s]*([\d,]+(?:\.\d+)?)/);
            if (feeMatch && feeMatch[1]) {
                processingFee = parseFloat(feeMatch[1].replace(/,/g, ''));
            }
        }

        // Extract total amount (from .summary-detail.primary or .summary-detail.overlap.primary)
        const totalRow = paymentSummary.find('.summary-detail.primary .value, .summary-detail.overlap.primary .value, #cashier-currency-parent .value');
        if (totalRow.length > 0) {
            const totalText = totalRow.text().trim();
            const totalMatch = totalText.match(/(?:USD|EUR|GBP|CNY|NGN|GHS)[\s]*([\d,]+(?:\.\d+)?)/i) ||
                totalText.match(/[\$€£¥₦][\s]*([\d,]+(?:\.\d+)?)/);
            if (totalMatch && totalMatch[1]) {
                total = parseFloat(totalMatch[1].replace(/,/g, ''));
            }
        }

        // If we have all three values, return breakdown
        if (orderAmount !== null && processingFee !== null && total !== null) {
            return {
                orderAmount,
                processingFee,
                total,
            };
        }

        // If we only have total, try to calculate from what we have
        if (total !== null) {
            if (orderAmount !== null && processingFee !== null) {
                return {
                    orderAmount,
                    processingFee,
                    total,
                };
            }
            // If we have total but not breakdown, estimate
            if (orderAmount !== null) {
                processingFee = total - orderAmount;
                if (processingFee > 0) {
                    return {
                        orderAmount,
                        processingFee,
                        total,
                    };
                }
            }
        }

        return null;
    }

    /**
     * Extract subtotal/total amount (final total including fees)
     */
    private extractSubtotal(currency: string): number | null {
        const $ = this.$;

        // First try to get from payment breakdown
        const breakdown = this.extractPaymentBreakdown(currency);
        if (breakdown && breakdown.total) {
            return breakdown.total;
        }

        // Fallback to previous logic
        const paymentSummary = $('.checkoutV4-summary-ui-wrapper-container, .checkoutV4-summary-ui-wrapper');

        if (paymentSummary.length > 0) {
            // Look for the final total amount (usually in .summary-detail.primary)
            const totalRow = paymentSummary.find('.summary-detail.primary .value, .summary-detail.overlap.primary .value, #cashier-currency-parent .value');
            if (totalRow.length > 0) {
                const totalText = totalRow.text().trim();
                const totalMatch = totalText.match(/(?:USD|EUR|GBP|CNY|NGN|GHS)[\s]*([\d,]+(?:\.\d+)?)/i) ||
                    totalText.match(/[\$€£¥₦][\s]*([\d,]+(?:\.\d+)?)/);
                if (totalMatch && totalMatch[1]) {
                    const amount = parseFloat(totalMatch[1].replace(/,/g, ''));
                    if (!isNaN(amount) && amount > 0) {
                        return amount;
                    }
                }
            }
        }

        // Last resort: look in body text
        const bodyText = $('body').text();
        const totalPatterns = [
            new RegExp(`Total[\\s:]*${currency}[\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
            new RegExp(`Pay[\\s]+in[\\s]+${currency}[\\s]*([\\d,]+(?:\\.[\\d]+)?)`, 'i'),
        ];

        for (const pattern of totalPatterns) {
            const match = bodyText.match(pattern);
            if (match && match[1]) {
                const amount = parseFloat(match[1].replace(/,/g, ''));
                if (!isNaN(amount) && amount > 0) {
                    return amount;
                }
            }
        }

        return null;
    }

    /**
     * Extract product image URL from the specific structure
     * <div class="product-img"><img src="..." /></div>
     */
    private extractProductImage(): string | null {
        const $ = this.$;

        // First, try the specific structure: .product-img img
        const productImg = $('.product-img img').first();
        if (productImg.length > 0) {
            const src = productImg.attr('src') || productImg.attr('data-src') || productImg.attr('data-lazy-src');
            if (src) {
                // Remove size parameters from URL if present (e.g., _100x100.jpg)
                const cleanSrc = src.replace(/_\d+x\d+\.jpg/, '.jpg');
                return cleanSrc;
            }
        }

        // Fallback: look for product image in other locations
        const imageSelectors = [
            '[class*="product-image"] img',
            '[class*="order-image"] img',
            '[class*="item-image"] img',
            '[class*="product-thumb"] img',
            '.checkout-item img',
            '.order-product img',
        ];

        for (const selector of imageSelectors) {
            const img = $(selector).first();
            if (img.length > 0) {
                const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src');
                if (src && (src.includes('alicdn') || src.startsWith('http'))) {
                    // Remove size parameters from URL if present
                    const cleanSrc = src.replace(/_\d+x\d+\.jpg/, '.jpg');
                    return cleanSrc;
                }
            }
        }

        return null;
    }

    /**
     * Extract order items - returns a single item representing the entire order
     * Note: This is ONE item, not multiple items, even if there are "10 product(s)"
     */
    private extractItems(currency: string): CheckoutOrderItem[] {
        const $ = this.$;

        // Get item count from text like "10 product(s)" - this is just for display, not for splitting
        const itemCountMatch = $('.product-img-mask span, [data-i18n-key*="product.img_fold_tiltle"]').text().match(/(\d+)\s*product\(s\)/i);
        const itemCount = itemCountMatch ? parseInt(itemCountMatch[1]) : 1;

        // Extract product image from .product-img img
        const imageUrl = this.extractProductImage();

        // Extract order title/description
        let title = "Alibaba Order";
        const titleSelectors = [
            '[class*="order-title"]',
            '[class*="product-title"]',
            '[class*="order-name"]',
            'h1', 'h2', 'h3',
        ];

        for (const selector of titleSelectors) {
            const titleEl = $(selector).first();
            if (titleEl.length > 0) {
                const titleText = titleEl.text().trim();
                if (titleText && titleText.length > 3 && !titleText.includes('Order No')) {
                    title = titleText;
                    break;
                }
            }
        }

        // If no specific title found, use a generic one with item count
        if (title === "Alibaba Order" && itemCount > 1) {
            title = `Alibaba Order (${itemCount} products)`;
        }

        // Get order amount from payment breakdown (this is the order amount before fees)
        const breakdown = this.extractPaymentBreakdown(currency);
        const orderAmount = breakdown?.orderAmount || 0;

        // Return SINGLE item representing the entire order
        // This is ONE item, not split into multiple items
        return [{
            title: title,
            quantity: 1, // Always 1 - this represents the entire order as one item
            price: orderAmount > 0 ? orderAmount : 0,
            currency: currency,
            imageUrl: imageUrl,
        }];
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
        const paymentBreakdown = this.extractPaymentBreakdown(currency);
        const items = this.extractItems(currency);
        const paymentMethods = this.extractPaymentMethods();

        // Get item count from the "10 product(s)" text - this is the number of products in the order
        // But we treat it as ONE item in our system
        const itemCountMatch = this.$('.product-img-mask span, [data-i18n-key*="product.img_fold_tiltle"]').text().match(/(\d+)\s*product\(s\)/i);
        const itemCount = itemCountMatch ? parseInt(itemCountMatch[1]) : 1;

        return {
            orderNumber,
            subtotal,
            currency,
            paymentBreakdown: paymentBreakdown || undefined,
            items,
            itemCount: itemCount,
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
