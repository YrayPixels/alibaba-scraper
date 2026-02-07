import * as cheerio from 'cheerio';

/**
 * Interface for price tier (quantity-based pricing)
 */
export interface PriceTier {
  minQuantity: number;
  maxQuantity: number | null; // null means no upper limit
  price: number;
  currency: string;
}

/**
 * Interface for product variation option
 */
export interface VariationOption {
  value: string; // e.g., "White", "39(US 6.5)"
  imageUrl?: string | null; // For color variations
  selected?: boolean; // Whether this option is currently selected
}

/**
 * Interface for product variation (color, size, etc.)
 */
export interface ProductVariation {
  name: string; // e.g., "Color", "EUR Size", "Size"
  type: 'color' | 'size' | 'text' | 'other'; // Type of variation
  options: VariationOption[];
}

/**
 * Interface for Alibaba product data
 */
export interface AlibabaProduct {
  title: string;
  price: {
    min: number;
    max: number;
    currency: string;
  } | null;
  priceTiers: PriceTier[]; // Quantity-based pricing tiers
  moq: string | null; // Minimum Order Quantity
  images: string[];
  mainImage: string | null;
  supplier: {
    name: string | null;
    verified: boolean;
    yearsInBusiness: string | null;
    responseTime: string | null;
    country: string | null;
  };
  specifications: Record<string, string>;
  description: string | null;
  category: string | null;
  productUrl: string | null;
  sku: string | null;
  rating: {
    score: number | null;
    reviewCount: number | null;
  };
  shipping: {
    leadTime: string | null;
    shippingMethods: string[];
  };
  variations: ProductVariation[]; // Product variations (color, size, etc.)
}

/**
 * Scrapes Alibaba product page HTML and extracts product details
 */



export class AlibabaScraper {
  private $: cheerio.CheerioAPI;

  constructor(html: string) {
    this.$ = cheerio.load(html) as unknown as cheerio.CheerioAPI;
  }

  /**
   * Extract product title
   */
  private extractTitle(): string {
    const $ = this.$;

    // Try multiple selectors for title
    const selectors = [
      "h1[title]", // Modern Alibaba uses h1 with title attribute
      'h1[data-pl="product-title"]',
      "h1.product-title",
      ".product-title h1",
      'h1[class*="title"]',
      ".pdp-title h1",
      '[class*="ProductTitle"]',
      '[class*="product-name"]',
      ".detail-title",
      ".module_title h1",
      'meta[property="og:title"]',
      "h1",
    ];

    for (const selector of selectors) {
      if (selector.startsWith("meta")) {
        const title = $(selector).attr("content")?.trim();
        if (title && title.length > 3) return title;
      } else {
        // Try getting title attribute first
        const titleAttr = $(selector).first().attr("title");
        if (titleAttr && titleAttr.length > 3) return titleAttr;

        // Then try text content
        const title = $(selector).first().text().trim();
        if (title && title.length > 3) return title;
      }
    }

    return "Unknown Product";
  }

  /**
   * Extract product price information and quantity-based price tiers
   */
  private extractPrice(): {
    price: AlibabaProduct["price"];
    priceTiers: PriceTier[];
  } {
    const $ = this.$;
    const priceTiers: PriceTier[] = [];
    let prices: number[] = [];
    let currency = "USD";

    try {
      // Modern Alibaba uses data-testid="ladder-price" for quantity-based pricing
      const ladderContainer = $('[data-testid="ladder-price"]');

      if (ladderContainer.length > 0) {
        // Look for price-item elements within the ladder-price container
        const priceItems = ladderContainer.find(".price-item");

        priceItems.each((_, el) => {
          const $item = $(el);

          // Get quantity range from first div (usually has text-sm class)
          const quantityText = $item.find("div").first().text().trim();

          // Get price from second div or span (usually has text-2xl or font-bold)
          const priceText =
            $item.find("span").first().text().trim() ||
            $item.find("div").eq(1).text().trim() ||
            $item.find("div").last().text().trim();

          // Extract currency from price text
          if (priceText.includes("NGN") || priceText.includes("₦"))
            currency = "NGN";
          else if (priceText.includes("CNY") || priceText.includes("¥"))
            currency = "CNY";
          else if (priceText.includes("USD") || priceText.includes("US$"))
            currency = "USD";
          else if (priceText.includes("EUR") || priceText.includes("€"))
            currency = "EUR";
          else if (priceText.includes("GBP") || priceText.includes("£"))
            currency = "GBP";

          // Parse quantity range
          // Patterns: "2 - 200 pairs", "201 - 1000 pairs", ">= 1000000 pairs", "> 5000"
          let minQty = 1;
          let maxQty: number | null = null;

          // Handle ">= X" or "> X" format
          const greaterThanMatch =
            quantityText.match(/>\s*=\s*(\d+)/i) ||
            quantityText.match(/>\s*(\d+)/i);
          if (greaterThanMatch) {
            minQty = parseInt(greaterThanMatch[1]);
            maxQty = null; // No upper limit
          } else {
            // Handle "X - Y" or "X-Y" format
            const rangeMatch = quantityText.match(/(\d+)\s*[-~–—]\s*(\d+)/);
            if (rangeMatch) {
              minQty = parseInt(rangeMatch[1]);
              maxQty = parseInt(rangeMatch[2]);
            } else {
              // Try single number
              const singleMatch = quantityText.match(/(\d+)/);
              if (singleMatch) {
                minQty = parseInt(singleMatch[1]);
              }
            }
          }

          // Extract price number (remove currency symbols and spaces)
          const priceMatch = priceText.match(
            /(?:USD|CNY|EUR|GBP|NGN|US\$|¥|€|£|₦)?\s*([\d,]+\.?\d*)/
          );
          if (priceMatch) {
            const price = parseFloat(
              priceMatch[1].replace(/,/g, "").replace(/\s/g, "")
            );
            if (!isNaN(price) && price > 0) {
              priceTiers.push({
                minQuantity: minQty,
                maxQuantity: maxQty,
                price: price,
                currency: currency,
              });
              prices.push(price);
            }
          }
        });
      }

      // Fallback: Try the product-price container if no ladder pricing found
      if (priceTiers.length === 0) {
        const priceContainer = $(
          '[data-testid="product-price"], .module_price'
        );

        if (priceContainer.length > 0) {
          // Look for ladder pricing structure (quantity-based pricing)
          const ladderItems = priceContainer.find(
            '[class*="ladder"], [class*="price-item"], .price-row, tr'
          );

          ladderItems.each((_, el) => {
            const text = $(el).text().trim();

            // Extract currency from text
            if (text.includes("NGN") || text.includes("₦")) currency = "NGN";
            else if (text.includes("CNY") || text.includes("¥"))
              currency = "CNY";
            else if (text.includes("USD") || text.includes("US$"))
              currency = "USD";
            else if (text.includes("EUR") || text.includes("€"))
              currency = "EUR";
            else if (text.includes("GBP") || text.includes("£"))
              currency = "GBP";

            // Try to extract quantity range and price
            // Pattern: "1-99 pieces" or "100-499 pieces" or "500+ pieces"
            const quantityMatch = text.match(
              /(\d+)\s*[-~–—]\s*(\d+|\+)\s*(?:pieces?|units?|pairs?|sets?|pcs?)/i
            );
            const priceMatch = text.match(
              /(?:USD|CNY|EUR|GBP|NGN|US\$|¥|€|£|₦)?\s*([\d,]+\.?\d*)/g
            );

            if (quantityMatch && priceMatch) {
              const minQty = parseInt(quantityMatch[1]);
              const maxQtyStr = quantityMatch[2];
              const maxQty = maxQtyStr === "+" ? null : parseInt(maxQtyStr);

              // Extract price (usually the last number in the match)
              const priceNumbers = priceMatch
                .map((m) => {
                  const num = m.replace(/[^\d.,]/g, "").replace(/,/g, "");
                  return parseFloat(num);
                })
                .filter((p) => !isNaN(p) && p > 0);

              if (priceNumbers.length > 0) {
                const price = priceNumbers[priceNumbers.length - 1]; // Usually the last one is the price
                priceTiers.push({
                  minQuantity: minQty,
                  maxQuantity: maxQty,
                  price: price,
                  currency: currency,
                });
                prices.push(price);
              }
            } else {
              // Fallback: Extract any price numbers from the text
              const numbers = text.match(/[\d,]+\.?\d*/g);
              if (numbers) {
                numbers.forEach((num) => {
                  const price = parseFloat(
                    num.replace(/,/g, "").replace(/\s/g, "")
                  );
                  if (!isNaN(price) && price > 0 && price < 1000000) {
                    prices.push(price);
                  }
                });
              }
            }
          });
        }
      }

      // Try to find ladder pricing in table format
      if (priceTiers.length === 0) {
        const priceTable = $(
          'table[class*="price"], table[class*="ladder"], .price-table'
        );
        if (priceTable.length > 0) {
          priceTable.find("tr").each((_, row) => {
            const cells = $(row).find("td, th");
            if (cells.length >= 2) {
              const cellText = cells
                .map((_, cell) => $(cell).text().trim())
                .get();
              const quantityText = cellText[0] || "";
              const priceText =
                cellText[1] || cellText[cellText.length - 1] || "";

              // Extract quantity range
              const qtyMatch = quantityText.match(/(\d+)\s*[-~–—]\s*(\d+|\+)/);
              if (qtyMatch) {
                const minQty = parseInt(qtyMatch[1]);
                const maxQtyStr = qtyMatch[2];
                const maxQty = maxQtyStr === "+" ? null : parseInt(maxQtyStr);

                // Extract price
                const priceMatch = priceText.match(
                  /(?:USD|CNY|EUR|GBP|NGN|US\$|¥|€|£|₦)?\s*([\d,]+\.?\d*)/
                );
                if (priceMatch) {
                  const price = parseFloat(priceMatch[1].replace(/,/g, ""));
                  if (!isNaN(price) && price > 0) {
                    // Detect currency
                    if (priceText.includes("NGN") || priceText.includes("₦"))
                      currency = "NGN";
                    else if (
                      priceText.includes("CNY") ||
                      priceText.includes("¥")
                    )
                      currency = "CNY";
                    else if (
                      priceText.includes("USD") ||
                      priceText.includes("US$")
                    )
                      currency = "USD";
                    else if (
                      priceText.includes("EUR") ||
                      priceText.includes("€")
                    )
                      currency = "EUR";
                    else if (
                      priceText.includes("GBP") ||
                      priceText.includes("£")
                    )
                      currency = "GBP";

                    priceTiers.push({
                      minQuantity: minQty,
                      maxQuantity: maxQty,
                      price: price,
                      currency: currency,
                    });
                    prices.push(price);
                  }
                }
              }
            }
          });
        }
      }

      // Fallback: Try meta tags
      if (prices.length === 0) {
        const metaPrice = $('meta[property="product:price:amount"]').attr(
          "content"
        );
        const metaCurrency = $('meta[property="product:price:currency"]').attr(
          "content"
        );

        if (metaPrice) {
          const price = parseFloat(metaPrice);
          if (!isNaN(price)) {
            prices.push(price);
            currency = metaCurrency || "USD";
          }
        }
      }

      // Fallback: Search for common price patterns
      if (prices.length === 0) {
        const priceSelectors = [
          ".price-text",
          '[class*="price"]',
          ".product-price",
          '[data-pl="price"]',
        ];

        for (const selector of priceSelectors) {
          const elements = $(selector);
          elements.each((_, el) => {
            const text = $(el).text().trim();

            // Look for currency
            if (text.includes("NGN")) currency = "NGN";
            else if (text.includes("CNY") || text.includes("¥"))
              currency = "CNY";
            else if (text.includes("USD") || text.includes("$"))
              currency = "USD";

            const numbers = text.match(/[\d,]+\.?\d*/g);
            if (numbers) {
              numbers.forEach((num) => {
                const price = parseFloat(num.replace(/,/g, ""));
                if (!isNaN(price) && price > 0 && price < 1000000) {
                  prices.push(price);
                }
              });
            }
          });

          if (prices.length > 0) break;
        }
      }

      // Filter out outliers and sort
      if (prices.length > 0) {
        prices = prices.filter((p) => p > 0).sort((a, b) => a - b);
      }

      // If we have price tiers, sort them by quantity
      if (priceTiers.length > 0) {
        priceTiers.sort((a, b) => a.minQuantity - b.minQuantity);
      } else if (prices.length > 0) {
        // If no tiers found but we have prices, create a single tier
        priceTiers.push({
          minQuantity: 1,
          maxQuantity: null,
          price: prices[0],
          currency: currency,
        });
      }

      return {
        price:
          prices.length > 0
            ? {
              min: prices[0],
              max: prices[prices.length - 1],
              currency,
            }
            : null,
        priceTiers: priceTiers,
      };
    } catch (error) {
      console.error("Error extracting price:", error);
    }

    return { price: null, priceTiers: [] };
  }

  /**
   * Extract Minimum Order Quantity (MOQ)
   */
  private extractMOQ(): string | null {
    const $ = this.$;

    // Modern Alibaba shows MOQ in ladder pricing ranges
    const priceRanges = $(
      '[data-testid="ladder-price"] .price-item, .price-item'
    );
    if (priceRanges.length > 0) {
      const firstRange = $(priceRanges[0]).text().trim();
      const match = firstRange.match(
        /(\d+)\s*-\s*\d+\s*(pairs?|pieces?|units?)/i
      );
      if (match) {
        return `${match[1]} ${match[2]}`;
      }

      // Try to get just the number and unit
      const simpleMatch = firstRange.match(/(\d+)\s*(pairs?|pieces?|units?)/i);
      if (simpleMatch) {
        return `${simpleMatch[1]} ${simpleMatch[2]}`;
      }
    }

    const moqSelectors = [
      '[class*="moq"]',
      '[class*="minimum-order"]',
      ".min-order",
      '[data-pl="moq"]',
    ];

    for (const selector of moqSelectors) {
      const moq = $(selector).first().text().trim();
      if (moq) return moq;
    }

    // Try to find MOQ in text content
    const bodyText = $("body").text();
    const moqMatch = bodyText.match(
      /(?:MOQ|Minimum Order|Min\. Order)[:\s]+(\d+\s*\w+)/i
    );
    if (moqMatch) return moqMatch[1];

    return "1 piece";
  }

  /**
   * Extract product images
   */
  private extractImages(): { images: string[]; mainImage: string | null } {
    const $ = this.$;
    const images: string[] = [];
    let mainImage: string | null = null;

    // Modern Alibaba uses background-image in style attribute for thumbnails
    const thumbElements = $(
      '[class*="thumb"], .image-thumb, [role="group"][aria-roledescription="slide"]'
    );
    thumbElements.each((_, el) => {
      const style = $(el).attr("style");
      if (style) {
        const bgMatch = style.match(/background-image:\s*url\(['"](.*?)['"]\)/);
        if (bgMatch) {
          const url = this.normalizeImageUrl(bgMatch[1]);
          if (url && !images.includes(url)) {
            images.push(url);
          }
        }
      }
    });

    // Extract main image from various sources
    const mainImageSelectors = [
      '[data-testid="product-image-view"] img',
      ".current-main-image",
      ".main-image img",
      ".product-image img",
      '[class*="main-img"]',
      ".image-view img",
      '[data-pl="main-image"]',
      '[data-testid="media-image"] img',
    ];

    for (const selector of mainImageSelectors) {
      const element = $(selector).first();
      // Check multiple attributes for image URLs (including lazy-loading attributes)
      const src = element.attr("src") ||
        element.attr("data-src") ||
        element.attr("data-lazy") ||
        element.attr("data-original") ||
        element.attr("data-url");
      if (src) {
        mainImage = this.normalizeImageUrl(src);
        break;
      }
    }

    // Extract all product images from img tags
    const imageSelectors = [
      ".image-thumb img",
      ".product-images img",
      '[class*="thumb"] img',
      ".image-gallery img",
      '[data-pl="product-image"]',
      '[data-testid="media-image"] img',
    ];

    imageSelectors.forEach((selector) => {
      $(selector).each((_, el) => {
        // Check multiple attributes for image URLs (including lazy-loading attributes)
        const src =
          $(el).attr("src") ||
          $(el).attr("data-src") ||
          $(el).attr("data-lazy") ||
          $(el).attr("data-original") ||
          $(el).attr("data-url");
        if (src) {
          const normalizedUrl = this.normalizeImageUrl(src);
          if (normalizedUrl && !images.includes(normalizedUrl)) {
            images.push(normalizedUrl);
          }
        }
      });
    });

    // If no images found, try all images on page
    if (images.length === 0) {
      $("img").each((_, el) => {
        // Check multiple attributes for image URLs
        const src = $(el).attr("src") ||
          $(el).attr("data-src") ||
          $(el).attr("data-lazy") ||
          $(el).attr("data-original") ||
          $(el).attr("data-url");
        if (
          src &&
          (src.includes("alicdn.com") || src.includes("alibaba.com")) &&
          (src.includes("kf/") ||
            src.includes("product") ||
            src.includes("img"))
        ) {
          const normalizedUrl = this.normalizeImageUrl(src);
          if (
            normalizedUrl &&
            !images.includes(normalizedUrl) &&
            !src.includes("icon") &&
            !src.includes("logo") &&
            src.length > 50
          ) {
            images.push(normalizedUrl);
          }
        }
      });
    }

    if (mainImage && !images.includes(mainImage)) {
      images.unshift(mainImage);
    } else if (!mainImage && images.length > 0) {
      mainImage = images[0];
    }

    return { images, mainImage };
  }

  /**
   * Normalize image URL (handle relative URLs, thumbnails, etc.)
   */
  /**
   * Convert hex color to RGB
   */
  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    // Handle 3-digit hex
    if (hex.length === 3) {
      hex = hex.split('').map(char => char + char).join('');
    }

    const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
      : null;
  }

  /**
   * Convert RGB values to a color name
   */
  private rgbToColorName(r: number, g: number, b: number): string {
    // Common color mappings
    const colors: Array<{ name: string; rgb: [number, number, number] }> = [
      { name: 'White', rgb: [255, 255, 255] },
      { name: 'Black', rgb: [0, 0, 0] },
      { name: 'Red', rgb: [255, 0, 0] },
      { name: 'Green', rgb: [0, 128, 0] },
      { name: 'Blue', rgb: [0, 0, 255] },
      { name: 'Yellow', rgb: [255, 255, 0] },
      { name: 'Pink', rgb: [255, 192, 203] },
      { name: 'Orange', rgb: [255, 165, 0] },
      { name: 'Purple', rgb: [128, 0, 128] },
      { name: 'Brown', rgb: [165, 42, 42] },
      { name: 'Gray', rgb: [128, 128, 128] },
      { name: 'Grey', rgb: [128, 128, 128] },
      { name: 'Silver', rgb: [192, 192, 192] },
      { name: 'Gold', rgb: [255, 215, 0] },
      { name: 'Navy', rgb: [0, 0, 128] },
      { name: 'Beige', rgb: [245, 245, 220] },
      { name: 'Cyan', rgb: [0, 255, 255] },
      { name: 'Magenta', rgb: [255, 0, 255] },
    ];

    // Find closest color match using Euclidean distance
    let minDistance = Infinity;
    let closestColor = `RGB(${r},${g},${b})`;

    for (const color of colors) {
      const distance = Math.sqrt(
        Math.pow(r - color.rgb[0], 2) +
        Math.pow(g - color.rgb[1], 2) +
        Math.pow(b - color.rgb[2], 2)
      );

      // If very close (within 30 units), use the color name
      if (distance < 30 && distance < minDistance) {
        minDistance = distance;
        closestColor = color.name;
      }
    }

    return closestColor;
  }

  private normalizeImageUrl(url: string): string {
    if (!url) return "";

    // Remove thumbnail suffixes to get full-size image
    url = url.replace(/_\d+x\d+\.(jpg|png|webp|jpeg)/i, ".$1");
    url = url.replace(
      /_(80x80|50x50|100x100|350x350)\.(jpg|png|webp|jpeg)/i,
      ".$2"
    );

    // Replace small size with larger size for better quality
    if (url.includes("_480x480")) {
      url = url.replace("_480x480", "_960x960");
    } else if (url.includes("80x80")) {
      url = url.replace("80x80", "960x960");
    }

    // Handle relative URLs
    if (url.startsWith("//")) {
      return "https:" + url;
    } else if (url.startsWith("/")) {
      return "https://www.alibaba.com" + url;
    }

    return url;
  }

  /**
   * Extract supplier information
   */
  private extractSupplier(): AlibabaProduct["supplier"] {
    const $ = this.$;

    const supplier: AlibabaProduct["supplier"] = {
      name: null,
      verified: false,
      yearsInBusiness: null,
      responseTime: null,
      country: null,
    };

    // Modern Alibaba structure - extract supplier name from company card or product company
    const nameSelectors = [
      ".company-name a",
      ".product-company-info .company-name a",
      ".supplier-name",
      '[class*="company-name"]',
      ".store-name",
      '[data-pl="supplier-name"]',
    ];

    for (const selector of nameSelectors) {
      const element = $(selector).first();
      const name = element.attr("title") || element.text().trim();
      if (name && name.length > 2) {
        supplier.name = name;
        break;
      }
    }

    // Check if verified
    supplier.verified =
      $(".verified-supplier").length > 0 ||
      $('[class*="verified"]').length > 0 ||
      $("body").text().includes("Verified Supplier") ||
      $("body").text().includes("Manufacturer") ||
      $("body").text().includes("Trading Company");

    // Extract years in business (modern format: "3 yrs")
    const companyInfo = $(".product-company-info, .company-life").text();
    const yearsMatch = companyInfo.match(
      /(\d+)\s*(?:yrs?|years?)\s*(?:on Alibaba)?/i
    );
    if (yearsMatch) {
      supplier.yearsInBusiness = yearsMatch[1] + " years";
    } else {
      // Fallback pattern
      const bodyMatch = $("body")
        .text()
        .match(/(\d+)\s*(?:years?|yrs?)\s*(?:in business|on Alibaba)/i);
      if (bodyMatch) {
        supplier.yearsInBusiness = bodyMatch[1] + " years";
      }
    }

    // Extract response time
    const responseSelectors = [
      '[class*="response-time"]',
      '[class*="Response Time"]',
      ".response-rate",
    ];

    for (const selector of responseSelectors) {
      const response = $(selector).first().text().trim();
      const match = response.match(/[≤<]?\s*\d+\s*[hm]/i);
      if (match) {
        supplier.responseTime = match[0];
        break;
      }
    }

    // Extract country from flag image or text
    const countryImg = $(
      '.product-company-info img[src*="flags"], .register-country'
    ).parent();
    if (countryImg.length > 0) {
      const countryText = countryImg.text().trim();
      if (countryText && countryText.length <= 10) {
        supplier.country = countryText;
      }
    }

    if (!supplier.country) {
      const countrySelectors = [
        ".country",
        '[class*="location"]',
        ".supplier-country",
        ".register-country",
      ];

      for (const selector of countrySelectors) {
        const country = $(selector).first().text().trim();
        if (country && country.length <= 20) {
          supplier.country = country;
          break;
        }
      }
    }

    return supplier;
  }

  /**
   * Extract product specifications
   */
  private extractSpecifications(): Record<string, string> {
    const $ = this.$;
    const specifications: Record<string, string> = {};

    // Modern Alibaba uses data-testid="module-attribute"
    const attributeSection = $(
      '[data-testid="module-attribute"], .module_attribute'
    );

    if (attributeSection.length > 0) {
      // Look for grid structure with two columns
      const rows = attributeSection.find(
        '[class*="grid-cols-2"] > div, .id-grid > div'
      );

      rows.each((_, row) => {
        const cells = $(row).find("> div");
        if (cells.length === 2) {
          const key = $(cells[0]).text().trim();
          const value = $(cells[1]).text().trim();
          if (key && value && key.length < 100) {
            specifications[key] = value;
          }
        }
      });
    }

    // Try to find specifications table
    if (Object.keys(specifications).length === 0) {
      const specSelectors = [
        ".product-specs table",
        ".specifications table",
        '[class*="spec"] table',
        ".product-properties table",
      ];

      for (const selector of specSelectors) {
        $(selector)
          .find("tr")
          .each((_, row) => {
            const cells = $(row).find("td, th");
            if (cells.length >= 2) {
              const key = $(cells[0]).text().trim();
              const value = $(cells[1]).text().trim();
              if (key && value) {
                specifications[key] = value;
              }
            }
          });
      }
    }

    // Try key-value pairs in divs
    if (Object.keys(specifications).length === 0) {
      $('.specification-item, .spec-item, [class*="property"]').each(
        (_, el) => {
          const key = $(el).find(".spec-key, .property-key, dt").text().trim();
          const value = $(el)
            .find(".spec-value, .property-value, dd")
            .text()
            .trim();
          if (key && value) {
            specifications[key] = value;
          }
        }
      );
    }

    return specifications;
  }

  /**
   * Extract product description
   */
  private extractDescription(): string | null {
    const $ = this.$;

    const descSelectors = [
      ".product-description",
      '[class*="description"]',
      ".detail-desc",
      '[data-pl="description"]',
    ];

    for (const selector of descSelectors) {
      const desc = $(selector).first().text().trim();
      if (desc && desc.length > 10) {
        return desc;
      }
    }

    return null;
  }

  /**
   * Extract product category
   */
  private extractCategory(): string | null {
    const $ = this.$;

    const categorySelectors = [
      ".breadcrumb",
      '[class*="category"]',
      ".product-category",
      '[data-pl="breadcrumb"]',
    ];

    for (const selector of categorySelectors) {
      const category = $(selector).first().text().trim();
      if (category) {
        return category.replace(/\s+/g, " ");
      }
    }

    return null;
  }

  /**
   * Extract SKU/Product ID
   */
  private extractSKU(): string | null {
    const $ = this.$;

    const skuSelectors = [
      '[class*="sku"]',
      '[class*="product-id"]',
      ".item-number",
    ];

    for (const selector of skuSelectors) {
      const sku = $(selector).first().text().trim();
      if (sku) {
        const skuMatch = sku.match(/[A-Z0-9-]+/);
        if (skuMatch) return skuMatch[0];
      }
    }

    // Try to find in meta tags
    const metaSku = $('meta[property="product:sku"]').attr("content");
    if (metaSku) return metaSku;

    return null;
  }

  /**
   * Extract rating and reviews
   */
  private extractRating(): AlibabaProduct["rating"] {
    const $ = this.$;

    const rating: AlibabaProduct["rating"] = {
      score: null,
      reviewCount: null,
    };

    // Modern Alibaba structure - extract from comment section
    const commentSection = $(".detail-product-comment, .module_comment");
    if (commentSection.length > 0) {
      const text = commentSection.text();

      // Extract rating score (e.g., "4.2")
      const scoreMatch = text.match(/(\d+\.?\d*)\s*\(/);
      if (scoreMatch) {
        rating.score = parseFloat(scoreMatch[1]);
      }

      // Extract review count (e.g., "(35 reviews)")
      const reviewMatch = text.match(/\((\d+)\s*(?:reviews?|ratings?)\)/i);
      if (reviewMatch) {
        rating.reviewCount = parseInt(reviewMatch[1]);
      }
    }

    // Fallback: Try rating selectors
    if (!rating.score) {
      const ratingSelectors = [
        ".rating-score",
        '[class*="rating"]',
        ".star-rating",
      ];

      for (const selector of ratingSelectors) {
        const ratingText = $(selector).first().text().trim();
        const ratingMatch = ratingText.match(
          /(\d+\.?\d*)\s*(?:\/\s*5|stars?)?/i
        );
        if (ratingMatch) {
          rating.score = parseFloat(ratingMatch[1]);
          break;
        }
      }
    }

    // Fallback: Extract review count from anywhere
    if (!rating.reviewCount) {
      const reviewText = $("body").text();
      const reviewMatch = reviewText.match(
        /\((\d+)\s*(?:reviews?|ratings?)\)/i
      );
      if (reviewMatch) {
        rating.reviewCount = parseInt(reviewMatch[1]);
      }
    }

    return rating;
  }

  /**
   * Extract shipping information
   */
  private extractShipping(): AlibabaProduct["shipping"] {
    const $ = this.$;

    const shipping: AlibabaProduct["shipping"] = {
      leadTime: null,
      shippingMethods: [],
    };

    // Extract lead time
    const leadTimeMatch = $("body")
      .text()
      .match(/(?:Lead Time|Delivery Time)[:\s]+([^<\n]+)/i);
    if (leadTimeMatch) {
      shipping.leadTime = leadTimeMatch[1].trim();
    }

    // Extract shipping methods
    $('[class*="shipping"], [class*="delivery"]').each((_, el) => {
      const method = $(el).text().trim();
      if (method && method.length < 100) {
        shipping.shippingMethods.push(method);
      }
    });

    return shipping;
  }

  /**
   * Extract product variations (color, size, etc.)
   */
  private extractVariations(): ProductVariation[] {
    const $ = this.$;
    const variations: ProductVariation[] = [];

    try {
      // All variations are held in elements with data-testid="sku-list"
      // Each sku-list represents ONE variation type (e.g., Color, Size, etc.)
      // Each sku-list contains:
      //   - h4 with data-testid="sku-list-title" (variation name)
      //   - div with data-testid="sku-list-item" (container for options)
      //     - div with data-testid="non-last-sku-item" (each option)
      //       - span with the actual value

      // Find all sku-list containers (one per variation type)
      const skuLists = $('[data-testid="sku-list"]');

      console.log(`🔍 Found ${skuLists.length} sku-list element(s)`);

      skuLists.each((_, skuListEl) => {
        const $skuList = $(skuListEl);

        // Extract variation name from title
        const titleEl = $skuList.find('[data-testid="sku-list-title"]').first();
        if (titleEl.length === 0) {
          console.log(`⚠️ Skipping sku-list: no title found`);
          return; // Skip if no title found
        }

        let variationName = titleEl.text().trim();

        // Try to get from span if title has nested structure
        const spanText = titleEl.find('span').first().text().trim();
        if (spanText && spanText.length > 0) {
          variationName = spanText;
        }

        // Extract the actual variation name (before colon if present)
        const nameMatch = variationName.match(/^([^:]+)/);
        if (nameMatch) {
          variationName = nameMatch[1].trim();
        }

        if (!variationName || variationName.length === 0) {
          console.log(`⚠️ Skipping sku-list: no valid variation name`);
          return; // Skip if no valid name
        }

        // Determine variation type based on name
        let variationType: ProductVariation['type'] = 'other';
        const nameLower = variationName.toLowerCase();
        if (nameLower.includes('color') || nameLower.includes('colour')) {
          variationType = 'color';
        } else if (nameLower.includes('size') || nameLower.includes('sizing') ||
          nameLower.includes('eur') || nameLower.includes('us size') ||
          nameLower.includes('uk size')) {
          variationType = 'size';
        } else {
          variationType = 'text';
        }

        // Find the items container within this sku-list (scoped to this specific sku-list)
        const itemsContainer = $skuList.find('[data-testid="sku-list-item"]').first();

        if (itemsContainer.length === 0) {
          console.log(`⚠️ Variation "${variationName}" found but no items container`);
          return;
        }

        // Get all variation options for this specific variation
        const options: VariationOption[] = [];

        // Find all option items (non-last-sku-item) within this sku-list's container
        const optionElements = itemsContainer.find('[data-testid="non-last-sku-item"]');

        console.log(`  📦 Processing "${variationName}" (${variationType}): found ${optionElements.length} option(s)`);

        optionElements.each((_, item) => {
          const $item = $(item);

          // Check if this option is selected
          const isSelected = $item.find('[data-testid="double-bordered-box"].selected').length > 0 ||
            $item.find('[class*="double-bordered-box"].selected').length > 0;

          // Try to extract image (for color variations)
          let imageUrl: string | null = null;
          const img = $item.find('img').first();

          if (img.length > 0) {
            // Get image URL
            const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy');
            if (src) {
              imageUrl = this.normalizeImageUrl(src);
            }

            // Get value from alt text or title attribute
            const altText = img.attr('alt') || img.attr('title') || '';
            if (altText && altText.trim().length > 0) {
              options.push({
                value: altText.trim(),
                imageUrl,
                selected: isSelected,
              });
              return; // Continue to next item
            }
          }

          // Check for color variations using background-color CSS style
          const colorBox = $item.find('[data-testid="double-bordered-box"], [class*="double-bordered-box"]').first();

          if (colorBox.length > 0) {
            const style = colorBox.attr('style') || '';
            const bgColorMatch = style.match(/background-color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/i) ||
              style.match(/background-color:\s*#([0-9a-fA-F]{3,6})/i);

            if (bgColorMatch) {
              let colorName: string;
              if (bgColorMatch[1] && bgColorMatch[2] && bgColorMatch[3]) {
                // RGB format
                const r = parseInt(bgColorMatch[1]);
                const g = parseInt(bgColorMatch[2]);
                const b = parseInt(bgColorMatch[3]);
                colorName = this.rgbToColorName(r, g, b);
              } else if (bgColorMatch[1]) {
                // Hex format
                const hex = bgColorMatch[1];
                const rgb = this.hexToRgb(hex);
                if (rgb) {
                  colorName = this.rgbToColorName(rgb.r, rgb.g, rgb.b);
                } else {
                  colorName = `#${hex}`;
                }
              } else {
                colorName = 'Unknown';
              }

              // Check if there's a title or aria-label that might have the color name
              const title = colorBox.attr('title') || $item.attr('title') || '';
              const ariaLabel = colorBox.attr('aria-label') || $item.attr('aria-label') || '';
              const colorNameFromAttr = title || ariaLabel;

              if (colorNameFromAttr && colorNameFromAttr.trim().length > 0) {
                colorName = colorNameFromAttr.trim();
              }

              options.push({
                value: colorName,
                imageUrl: null, // No image for CSS color boxes
                selected: isSelected,
              });
              return; // Continue to next item
            }
          }

          // For text-based variations (sizes), extract from span
          // The value is typically in a span inside the item
          const valueSpan = $item.find('span').filter((_, el) => {
            const $el = $(el);
            const text = $el.text().trim();
            // Prefer spans that have text but no nested spans with text
            return text.length > 0 && $el.find('span').length === 0;
          }).first();

          let value: string | null = null;

          if (valueSpan.length > 0) {
            value = valueSpan.text().trim();
          } else {
            // Fallback: get all text from the item itself
            value = $item.text().trim();
          }

          // Allow numeric values (sizes like "39", "40", etc.) and other text values
          if (value && value.length > 0 && value.length < 100) {
            // Avoid duplicates
            if (!options.some(opt => opt.value === value)) {
              options.push({
                value: value,
                imageUrl: null,
                selected: isSelected,
              });
            }
          }
        });

        // If we found options, add this variation
        if (options.length > 0 && variationName && variationName.length > 0) {
          console.log(`✅ Found variation: "${variationName}" (${variationType}) with ${options.length} option(s):`, options.map(o => o.value).join(', '));
          variations.push({
            name: variationName,
            type: variationType,
            options: options,
          });
        } else {
          console.log(`⚠️ Variation "${variationName}" found but no options extracted`);
        }
      });

      console.log(`📊 Total variations extracted: ${variations.length}`);

      // Fallback: Try to find variations using old method if no sku-list found
      if (variations.length === 0) {
        const skuModule = $('.module_sku, [data-module-name="module_sku"]');

        if (skuModule.length > 0) {
          // Look for variation groups
          skuModule.find('h3, h4').each((_, titleEl) => {
            const $title = $(titleEl);
            const titleText = $title.text().trim();

            // Check if this looks like a variation title
            if (titleText.match(/^(Color|Size|Colour|EUR Size|US Size|UK Size|Style|Material)/i)) {
              const variationName = titleText.replace(/^[^:]*:\s*/, '').trim() || titleText;
              let variationType: ProductVariation['type'] = 'other';

              const nameLower = variationName.toLowerCase();
              if (nameLower.includes('color') || nameLower.includes('colour')) {
                variationType = 'color';
              } else if (nameLower.includes('size')) {
                variationType = 'size';
              }

              const options: VariationOption[] = [];

              // Find options in the next sibling or parent container
              const container = $title.next('[class*="flex"], [class*="grid"], div').first();
              if (container.length === 0) {
                const parent = $title.parent();
                container.find('[class*="flex"], [class*="grid"], div').first();
              }

              container.find('img, span, div[class*="box"]').each((_, optionEl) => {
                const $option = $(optionEl);

                // Check for image
                const img = $option.is('img') ? $option : $option.find('img').first();
                if (img.length > 0) {
                  const src = img.attr('src') || img.attr('data-src');
                  const alt = img.attr('alt') || img.attr('title') || '';
                  if (alt) {
                    options.push({
                      value: alt.trim(),
                      imageUrl: src ? this.normalizeImageUrl(src) : null,
                      selected: false,
                    });
                  }
                } else {
                  // Text option
                  const text = $option.text().trim();
                  if (text && text.length > 0 && text.length < 50) {
                    options.push({
                      value: text,
                      imageUrl: null,
                      selected: false,
                    });
                  }
                }
              });

              if (options.length > 0) {
                variations.push({
                  name: variationName,
                  type: variationType,
                  options: options,
                });
              }
            }
          });
        }
      }
    } catch (error) {
      console.error('Error extracting variations:', error);
    }

    return variations;
  }

  /**
   * Scrape all product data
   */
  public scrape(): AlibabaProduct {
    const { images, mainImage } = this.extractImages();
    const { price, priceTiers } = this.extractPrice();

    return {
      title: this.extractTitle(),
      price: price,
      priceTiers: priceTiers,
      moq: this.extractMOQ(),
      images,
      mainImage,
      supplier: this.extractSupplier(),
      specifications: this.extractSpecifications(),
      description: this.extractDescription(),
      category: this.extractCategory(),
      productUrl: null, // Will be set externally
      sku: this.extractSKU(),
      rating: this.extractRating(),
      shipping: this.extractShipping(),
      variations: this.extractVariations(),
    };
  }
}

/**
 * Generate random realistic user agents
 */
function getRandomUserAgent(): string {
  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * Normalize URL by adding protocol if missing
 */
function normalizeUrl(url: string): string {
  if (!url) return url;

  // If URL already has protocol, return as-is
  if (url.match(/^https?:\/\//i)) {
    return url;
  }

  // If URL starts with //, add https:
  if (url.startsWith("//")) {
    return "https:" + url;
  }

  // Otherwise, add https://
  return "https://" + url;
}

/**
 * Scrape Alibaba product from URL with retry logic
 */
export async function scrapeFromUrl(
  url: string,
  retries: number = 3
): Promise<AlibabaProduct> {
  // Normalize URL (add protocol if missing)
  url = normalizeUrl(url);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Add delay between retries to avoid rate limiting
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }

      // More realistic headers that mimic a real browser
      const headers: Record<string, string> = {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'DNT': '1',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
      };

      // Add referer for more authenticity (looks like coming from Alibaba search)
      if (attempt > 1) {
        headers['Referer'] = 'https://www.alibaba.com/';
      }

      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
      }

      const html = await response.text();

      // Check if we got a valid HTML response
      if (!html || html.length < 100) {
        throw new Error('Received empty or invalid response from Alibaba');
      }

      // Check for common error pages
      if (html.includes('Access Denied') || html.includes('Blocked') || html.includes('captcha')) {
        throw new Error('Access denied by Alibaba. The page may be protected or your IP may be temporarily blocked.');
      }

      const scraper = new AlibabaScraper(html);
      const product = scraper.scrape();
      product.productUrl = url;

      // Validate that we got at least basic product info
      if (!product.title || product.title === 'Unknown Product') {
        throw new Error('Failed to extract product information. The page structure may have changed.');
      }

      return product;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Scraping attempt ${attempt} failed:`, lastError.message);

      // Don't retry on certain errors
      if (
        lastError.message.includes('Access Denied') ||
        lastError.message.includes('404') ||
        lastError.message.includes('invalid URL') ||
        lastError.message.includes('Failed to parse URL')
      ) {
        break;
      }
    }
  }

  throw new Error(
    `Failed to scrape product after ${retries} attempts. Last error: ${lastError?.message || 'Unknown error'}`
  );
}

