const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const path = require('path');
const fs = require('fs');


// Helper functions for formatting
handlebars.registerHelper('formatDate', function(date) {
    return new Date(date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });
});

// Helper for formatting time in 12-hour format with AM/PM
handlebars.registerHelper('formatTime', function(time) {
    if (!time) return '';
    
    try {
        // If already in HH:MM:SS format (from IST conversion), convert to 12-hour format
        if (time.match(/^\d{2}:\d{2}:\d{2}$/)) {
            const [hours, minutes, seconds] = time.split(':').map(Number);
            const period = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12; // Convert 0 to 12, keep others as is
            return `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
        }
        
        // If it's a full datetime string, extract just the time part
        if (time.includes('T')) {
            time = time.split('T')[1];
        }
        
        // Remove any date part if present (e.g., "2023-09-16 14:30:00")
        if (time.includes(' ')) {
            time = time.split(' ')[1];
        }
        
        // Extract hours and minutes using regex
        const timeMatch = time.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
            const [, hours, minutes] = timeMatch;
            const hoursNum = parseInt(hours);
            const period = hoursNum >= 12 ? 'PM' : 'AM';
            const displayHours = hoursNum % 12 || 12;
            return `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
        }
        
        return '00:00 AM'; // fallback for invalid formats
    } catch (e) {
        return '00:00 AM'; // fallback for any errors
    }
});

// Helper for getting array length
handlebars.registerHelper('length', function(arr) {
    return arr ? arr.length : 0;
});

// Helper for equality comparison
handlebars.registerHelper('eq', function(value1, value2) {
    return value1 == value2;
});

// Helper for addition (used for Pax calculation)
handlebars.registerHelper('add', function(value1, value2) {
    return value1 + value2;
});

// Helper for calculating total Pax
handlebars.registerHelper('calculatePax', function(guests) {
    if (!guests) return 1;  // If no guests object, return 1 for primary guest
    const additionalCount = guests.additional ? guests.additional.length : 0;
    return 1 + additionalCount;  // 1 for primary guest + additional guests
});

// Helper for multiplication
handlebars.registerHelper('multiply', function(value1, value2) {
    return value1 * value2;
});

handlebars.registerHelper('formatCurrency', function(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount || 0);
});

// Function to calculate GST amounts (5% total = 2.5% CGST + 2.5% SGST)
// REVERSE GST: grossAmount is the TOTAL amount (WITH GST included) - divide by 1.05
// FORWARD GST: baseAmount - multiply by 1.05 to add GST
function calculateGST(amount, isForwardGST = false) {
    if (isForwardGST) {
        // Forward GST: Add 5% to base amount
        // console.log('Calculating FORWARD GST for base amount:', amount);
        const baseAmount = parseFloat(amount);
        const gstPercent = 0.05; // 5% total GST
        const cgstAmount = baseAmount * 0.025; // 2.5% CGST
        const sgstAmount = baseAmount * 0.025; // 2.5% SGST
        const totalGstAmount = baseAmount * gstPercent; // 5% of base
        const finalTotal = baseAmount + totalGstAmount; // base + GST
        
        // console.log('Forward GST calculation result:', { baseAmount: baseAmount.toFixed(2), cgstAmount: cgstAmount.toFixed(2), sgstAmount: sgstAmount.toFixed(2), totalGstAmount: totalGstAmount.toFixed(2), finalTotal: finalTotal.toFixed(2) });
        
        return {
            baseAmount: baseAmount.toFixed(2),
            cgstAmount: cgstAmount.toFixed(2),
            sgstAmount: sgstAmount.toFixed(2),
            totalGst: totalGstAmount.toFixed(2),
            finalTotal: finalTotal.toFixed(2)
        };
    } else {
        // Reverse GST: Extract base from gross amount
        // console.log('Calculating REVERSE GST for gross amount:', amount);
        
        const baseAmount = parseFloat(amount) / 1.05;
        const gstPercent = 0.05; // 5% total GST
        const totalGstAmount = baseAmount * gstPercent; // 5% of base
        const cgstAmount = baseAmount * 0.025; // 2.5% CGST
        const sgstAmount = baseAmount * 0.025; // 2.5% SGST
        const finalTotal = parseFloat(amount); // Already gross/final total
        
        // console.log('Reverse GST calculation result:', { baseAmount: baseAmount.toFixed(2), cgstAmount: cgstAmount.toFixed(2), sgstAmount: sgstAmount.toFixed(2), totalGstAmount: totalGstAmount.toFixed(2), finalTotal: finalTotal.toFixed(2) });
        
        return {
            baseAmount: baseAmount.toFixed(2),
            cgstAmount: cgstAmount.toFixed(2),
            sgstAmount: sgstAmount.toFixed(2),
            totalGst: totalGstAmount.toFixed(2),
            finalTotal: finalTotal.toFixed(2)
        };
    }
}

// Function to generate Food Bill PDF
async function generateFoodBillPDF(foodBillData) {

    let browser = null;
    try {
        const templatePath = path.join(__dirname, 'templates', 'foodBill.html');
        
        if (!fs.existsSync(templatePath)) {
            throw new Error('Food bill template file not found');
        }

        const templateHtml = fs.readFileSync(templatePath, 'utf-8');
        
        // Calculate total based on remaining quantities (after cancellations)
        let recalculatedTotal = 0;
        if (foodBillData.foodItems && Array.isArray(foodBillData.foodItems)) {
            recalculatedTotal = foodBillData.foodItems.reduce((sum, item) => {
                const remaining = Math.max(0, item.remaining_quantity || (item.quantity - (item.voided_quantity || 0)));
                return sum + ((item.price || 0) * remaining);
            }, 0);
        }
        
        const totalAmount = recalculatedTotal > 0 ? recalculatedTotal : parseFloat(foodBillData.foodOrder.total_amount);
        // Use REVERSE GST for food bill (extract GST from total, don't add extra)
        const { baseAmount, cgstAmount, sgstAmount, totalGst, finalTotal } = calculateGST(totalAmount, false);
        
        const template = handlebars.compile(templateHtml);
        const finalHtml = template({
            ...foodBillData,
            foodCalculations: {
                baseAmount,
                cgstAmount,
                sgstAmount,
                totalGst,
                finalTotal
            },
            currentDate: new Date().toISOString()
        });

        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--font-render-hinting=none'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({
            width: 1200,
            height: 1600,
            deviceScaleFactor: 2
        });

        await page.setContent(finalHtml, {
            waitUntil: 'networkidle0'
        });

        const pdf = await page.pdf({
            format: 'A4',
            margin: {
                top: '15px',
                right: '15px',
                bottom: '15px',
                left: '15px'
            },
            printBackground: true,
            preferCSSPageSize: true,
            timeout: 60000,
            displayHeaderFooter: false,
            scale: 0.95
        });

        return pdf;
    } catch (error) {
        throw new Error('Food bill PDF generation failed: ' + error.message);
    } finally {
        if (browser !== null) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Error closing browser:', closeError);
            }
        }
    }
}

async function generateInvoicePDF(invoiceData, foodBillData = null) {
    let browser = null;
    try {
        // Load room invoice template
        const roomTemplatePath = path.join(__dirname, 'templates', 'invoice.html');
        
        if (!fs.existsSync(roomTemplatePath)) {
            throw new Error('Invoice template file not found');
        }

        const roomTemplateHtml = fs.readFileSync(roomTemplatePath, 'utf-8');

        // Calculate split GST amounts from booking total amount
        const totalAmount = parseFloat(invoiceData.booking.total_amount);
        const { baseAmount, cgstAmount, sgstAmount } = calculateGST(totalAmount);
        
        // Compile room invoice template
        const roomTemplate = handlebars.compile(roomTemplateHtml);
        const roomHtml = roomTemplate({
            ...invoiceData,
            calculatedAmounts: {
                baseAmount,
                cgstAmount,
                sgstAmount
            }
        });

        // Prepare combined HTML
        let combinedHtml = roomHtml;

        // If food bill data exists, add food bill page
        if (foodBillData) {
            // console.log('\n🍽️ FOOD BILL DATA RECEIVED:');
            // console.log('   foodBillData.foodOrder:', foodBillData.foodOrder);
            const foodTemplatePath = path.join(__dirname, 'templates', 'foodBill.html');
            
            if (fs.existsSync(foodTemplatePath)) {
                const foodTemplateHtml = fs.readFileSync(foodTemplatePath, 'utf-8');
                
                // Calculate GST for food using total_amount (original order total, not affected by payments)
                const foodGrossAmount = parseFloat(foodBillData.foodOrder.total_amount);
                // console.log('   Food Total Amount (original order):', foodGrossAmount);
                const foodGST = calculateGST(foodGrossAmount, false);  // Use REVERSE GST for food bill (extract from total)
                // console.log('   Food GST Calculated:', foodGST);
                
                const foodTemplate = handlebars.compile(foodTemplateHtml);
                const foodHtml = foodTemplate({
                    ...foodBillData,
                    foodCalculations: {
                        baseAmount: foodGST.baseAmount,
                        cgstAmount: foodGST.cgstAmount,
                        sgstAmount: foodGST.sgstAmount,
                        totalGst: foodGST.totalGst,
                        finalTotal: foodGST.finalTotal
                    },
                    currentDate: new Date().toISOString()
                });

                // Combine both pages - room invoice first, then food bill
                combinedHtml = roomHtml + foodHtml;
                // console.log('   ✅ Food bill page added\n');
            }
        }

        // Launch Puppeteer
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: undefined, 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--font-render-hinting=none'
            ]
        });

        // console.log('Puppeteer launched successfully');

        const page = await browser.newPage();

        await page.setViewport({
            width: 1200,
            height: 1600,
            deviceScaleFactor: 2
        });

        await page.setContent(combinedHtml, {
            waitUntil: 'networkidle0'
        });

        // Generate single PDF with multiple pages
        const pdf = await page.pdf({
            format: 'A4',
            margin: {
                top: '15px',
                right: '15px',
                bottom: '15px',
                left: '15px'
            },
            printBackground: true,
            preferCSSPageSize: true,
            timeout: 60000,
            displayHeaderFooter: false,
            scale: 0.95
        });

        // console.log('PDF generated successfully, size:', pdf.length);

        return pdf;
    } catch (error) {
        console.error('Error generating PDF:', error);
        throw new Error('PDF generation failed: ' + error.message);
    } finally {
        if (browser !== null) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Error closing browser:', closeError);
            }
        }
    }
}

module.exports = { generateInvoicePDF };