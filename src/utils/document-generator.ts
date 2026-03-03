// Document Generator - Chain of Custody PDF Generation
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

interface ChainOfCustodyData {
  // Collection Information
  collectionDate: Date;
  driverName: string;
  siteName: string;
  sitePostcode: string;
  siteContactName?: string;
  vehicleReg?: string;

  // Optional signature/meta information
  driverSignature?: string; // Base64 signature image if available
  driverSignatureDate?: Date;
  siteContactSignature?: string; // Base64 signature image if available
  siteContactSignatureDate?: Date;

  // Collection Details
  dial2Collection?: string; // Number of operatives (1 or 2)
  securityRequirements?: string;
  idRequired?: string;
  loadingBayLocation?: string;
  vehicleHeightRestrictions?: string;
  doorLiftSize?: string;
  roadWorksPublicEvents?: string;
  manualHandlingRequirements?: string;

  // Items
  items: Array<{
    categoryName: string;
    quantity: number;
    serialNumbers?: string[];
  }>;

  // Job/Booking Info
  erpJobNumber?: string;
  bookingNumber: string;
  clientName: string;
  organisationName?: string;
}

/**
 * Generate Chain of Custody PDF document with professional styling
 */
export async function generateChainOfCustodyPDF(
  data: ChainOfCustodyData,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // Ensure output directory exists
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        bufferPages: true,
        info: {
          Title: 'Chain of Custody - UK GDPR Contract and Transfer of Custody',
          Author: 'Reuse Connect ITAD Platform',
          Subject: 'Chain of Custody Document',
        },
      });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Set up stream event handlers BEFORE ending the document
      stream.on('finish', () => {
        resolve(outputPath);
      });

      stream.on('error', (error) => {
        reject(error);
      });

      // Color scheme
      const primaryColor = '#1a5f3f'; // Dark green
      const textColor = '#1f2937'; // Dark gray
      const lightGray = '#f3f4f6';
      const borderColor = '#e5e7eb';

      // Header with company branding
      doc.rect(0, 0, doc.page.width, 110).fill(primaryColor);
      
      doc
        .fillColor('#ffffff')
        .fontSize(28)
        .font('Helvetica-Bold')
        .text('CHAIN OF CUSTODY', 40, 35, { align: 'left' });

      doc
        .fontSize(11)
        .font('Helvetica')
        .text(
          'UK GDPR CONTRACT AND TRANSFER OF CUSTODY',
          40,
          65,
          {
            align: 'left',
            width: doc.page.width - 80,
          }
        );
      
      // Legal entity text
      doc
        .fontSize(9)
        .font('Helvetica-Oblique') // Italic font for legal entity
        .fillColor('#e5e7eb')
        .text(
          '(Reuse Technology Group Ltd, trading as Reuse Connect)',
          40,
          88,
          {
            align: 'left',
            width: doc.page.width - 80,
          }
        );

      // Subtle divider line below header
      doc.fillColor(borderColor)
        .rect(0, 110, doc.page.width, 1)
        .fill();
      
      doc.fillColor(textColor);
      let yPos = 130;

      // Calculate box height based on content
      // Header: 15px, Spacing: 15px, Row 1: 20px, Row 2: 20px, Organisation (if exists): 20px, Bottom padding: 10px
      const boxHeight = data.organisationName ? 100 : 80;
      
      // Job Information Box
      doc.rect(40, yPos, 515, boxHeight)
        .fill(lightGray)
        .stroke(borderColor)
        .lineWidth(1.5);
      
      yPos += 15;
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor('#6b7280')
        .text('JOB INFORMATION', 50, yPos);
      
      yPos += 15;
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor(textColor);
      
      const jobInfo = [
        { label: 'Job Number:', value: data.erpJobNumber || '' },
        { label: 'Booking Number:', value: data.bookingNumber },
        { label: 'Contact Name:', value: data.clientName },
      ];
      
      // First row: Job Number (left) and Booking Number (right)
      const labelWidth = 120;
      const valueWidth = 150;
      const leftColX = 50;
      const rightColX = 320;
      
      // Job Number (left column) - only show if value exists
      doc.font('Helvetica')
        .fillColor('#6b7280')
        .text(jobInfo[0].label, leftColX, yPos, { width: labelWidth });
      if (jobInfo[0].value) {
        doc.font('Helvetica-Bold')
          .fillColor(textColor)
          .text(jobInfo[0].value, leftColX + labelWidth, yPos, { width: valueWidth });
      }
      
      // Booking Number (right column) - only show if value exists
      doc.font('Helvetica')
        .fillColor('#6b7280')
        .text(jobInfo[1].label, rightColX, yPos, { width: labelWidth });
      if (jobInfo[1].value) {
        doc.font('Helvetica-Bold')
          .fillColor(textColor)
          .text(jobInfo[1].value, rightColX + labelWidth, yPos, { width: valueWidth });
      }
      
      yPos += 20;
      
      // Client (left column, full width) - only show if value exists
      doc.font('Helvetica')
        .fillColor('#6b7280')
        .text(jobInfo[2].label, leftColX, yPos, { width: labelWidth });
      if (jobInfo[2].value) {
        doc.font('Helvetica-Bold')
          .fillColor(textColor)
          .text(jobInfo[2].value, leftColX + labelWidth, yPos, { width: 400 });
      }
      
      yPos += 20;

      // Organisation (if exists) - on its own line
      if (data.organisationName) {
        doc.font('Helvetica')
          .fillColor('#6b7280')
          .text('Organisation:', leftColX, yPos, { width: labelWidth });
        doc.font('Helvetica-Bold')
          .fillColor(textColor)
          .text(data.organisationName, leftColX + labelWidth, yPos, { width: 400 });
      }

      yPos += 40;

      // Collection Information Section
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('COLLECTION INFORMATION', 40, yPos);
      
      yPos += 25;
      doc.moveTo(40, yPos).lineTo(555, yPos).stroke(primaryColor);
      yPos += 15;

      // Collection info in two columns
      const collectionInfo = [
        { label: 'Collection Date:', value: data.collectionDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) },
        { label: 'Driver Name:', value: data.driverName },
        { label: 'Vehicle Registration:', value: data.vehicleReg || '' },
        { label: 'Site Name:', value: data.siteName },
        { label: 'Site Postcode:', value: data.sitePostcode },
        { label: 'Site Contact:', value: data.siteContactName || '' },
      ];

      doc.fontSize(10).font('Helvetica');
      collectionInfo.forEach((info, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = col === 0 ? 50 : 300;
        const y = yPos + (row * 25);

        doc.fillColor('#6b7280')
          .font('Helvetica')
          .text(info.label, x, y, { width: 140 });
        // Only render value if it's not empty
        if (info.value) {
          doc.fillColor(textColor)
            .font('Helvetica-Bold')
            .text(info.value, x + 140, y, { width: 100 });
        }
      });

      yPos += Math.ceil(collectionInfo.length / 2) * 25 + 25;

      // Signature sections (integrated smoothly into COLLECTION INFORMATION)
      // Subtle background box to group signatures
      doc.rect(40, yPos - 5, 515, 90)
        .fill('#fafafa')
        .stroke(borderColor)
        .lineWidth(0.5);
      
      yPos += 10;

      // Driver signature block
      doc.rect(45, yPos, 240, 80)
        .fill('#ffffff')
        .stroke(borderColor)
        .lineWidth(0.5);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#6b7280')
        .text('Driver Name (printed):', 50, yPos + 10);
      doc
        .font('Helvetica-Bold')
        .fillColor(textColor)
        .text(data.driverName || '____________________', 50, yPos + 25, { width: 220 });

      doc
        .font('Helvetica')
        .fillColor('#6b7280')
        .text('Signature:', 50, yPos + 45);
      if (data.driverSignature) {
        doc
          .font('Helvetica')
          .fillColor('#9ca3af')
          .text('[Signature captured separately / on file]', 115, yPos + 45, { width: 160 });
      } else {
        doc.moveTo(115, yPos + 57).lineTo(280, yPos + 57).stroke('#d1d5db');
      }

      doc
        .font('Helvetica')
        .fillColor('#6b7280')
        .text('Date:', 50, yPos + 60);
      const driverDateText = data.driverSignatureDate
        ? data.driverSignatureDate.toLocaleDateString('en-GB')
        : '';
      doc
        .font('Helvetica-Bold')
        .fillColor(textColor)
        .text(driverDateText || '____________________', 90, yPos + 60, { width: 180 });

      // Site contact signature block
      doc.rect(320, yPos, 240, 80)
        .fill('#ffffff')
        .stroke(borderColor)
        .lineWidth(0.5);
      doc
        .font('Helvetica')
        .fillColor('#6b7280')
        .text('Site Contact (printed):', 330, yPos + 10);
      doc
        .font('Helvetica-Bold')
        .fillColor(textColor)
        .text(data.siteContactName || '____________________', 330, yPos + 25, { width: 220 });

      doc
        .font('Helvetica')
        .fillColor('#6b7280')
        .text('Signature:', 330, yPos + 45);
      if (data.siteContactSignature) {
        doc
          .font('Helvetica')
          .fillColor('#9ca3af')
          .text('[Signature captured separately / on file]', 395, yPos + 45, { width: 160 });
      } else {
        doc.moveTo(395, yPos + 57).lineTo(560, yPos + 57).stroke('#d1d5db');
      }

      doc
        .font('Helvetica')
        .fillColor('#6b7280')
        .text('Date:', 330, yPos + 60);
      const siteDateText = data.siteContactSignatureDate
        ? data.siteContactSignatureDate.toLocaleDateString('en-GB')
        : '';
      doc
        .font('Helvetica-Bold')
        .fillColor(textColor)
        .text(siteDateText || '____________________', 370, yPos + 60, { width: 180 });

      yPos += 90;

      // Check if we need a new page
      if (yPos > 720) {
        doc.addPage();
        yPos = 40;
      }

      // Collection Details Section
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('COLLECTION DETAILS', 40, yPos);
      
      yPos += 25;
      doc.moveTo(40, yPos).lineTo(555, yPos).stroke(primaryColor);
      yPos += 15;

      const defaultDial2Text = '1 Person (Or 2 or more persons)';

      // Helper function to check if a value is empty (null, undefined, or empty string)
      const isEmpty = (value: string | undefined | null): boolean => {
        if (value === null || value === undefined) return true;
        if (typeof value === 'string' && value.trim() === '') return true;
        return false;
      };

      const collectionDetails = [
        {
          label: 'DIAL 2 Collection:',
          value: isEmpty(data.dial2Collection) ? defaultDial2Text : data.dial2Collection!,
          isDefault: isEmpty(data.dial2Collection),
        },
        {
          label: 'Security Requirements:',
          value: isEmpty(data.securityRequirements) ? '' : data.securityRequirements!,
          isDefault: isEmpty(data.securityRequirements),
        },
        {
          label: 'ID Required:',
          value: isEmpty(data.idRequired) ? '' : data.idRequired!,
          isDefault: isEmpty(data.idRequired),
        },
        {
          label: 'Loading Bay Location:',
          value: isEmpty(data.loadingBayLocation) ? '' : data.loadingBayLocation!,
          isDefault: isEmpty(data.loadingBayLocation),
        },
        {
          label: 'Vehicle Height Restrictions:',
          value: isEmpty(data.vehicleHeightRestrictions) ? '' : data.vehicleHeightRestrictions!,
          isDefault: isEmpty(data.vehicleHeightRestrictions),
        },
        {
          label: 'Door & Lift Size:',
          value: isEmpty(data.doorLiftSize) ? '' : data.doorLiftSize!,
          isDefault: isEmpty(data.doorLiftSize),
        },
        {
          label: 'Road Works / Public Events:',
          value: isEmpty(data.roadWorksPublicEvents) ? '' : data.roadWorksPublicEvents!,
          isDefault: isEmpty(data.roadWorksPublicEvents),
        },
        {
          label: 'Manual Handling Requirements:',
          value: isEmpty(data.manualHandlingRequirements) ? '' : data.manualHandlingRequirements!,
          isDefault: isEmpty(data.manualHandlingRequirements),
        },
      ];

      doc.fontSize(10).font('Helvetica');
      collectionDetails.forEach((detail) => {
        const labelHeight = doc.heightOfString(detail.label, { width: 200 });
        const valueHeight = doc.heightOfString(detail.value, { width: 300 });
        const rowHeight = Math.max(labelHeight, valueHeight) + 10;

        if (yPos + rowHeight > 720) {
          doc.addPage();
          yPos = 40;
        }

        doc.fillColor('#6b7280')
          .font('Helvetica-Bold')
          .text(detail.label, 50, yPos, { width: 200 });

        // Use lighter colour and italic font for default / inferred values to distinguish them visually
        // Display the value if it exists (including default values)
        // For DIAL 2 Collection, always show something (either user value or default)
        // For other fields, show value if provided, otherwise leave blank
        const shouldDisplay = detail.value && detail.value.trim().length > 0;
        if (shouldDisplay || detail.label === 'DIAL 2 Collection:') {
          const valueColor = (detail as any).isDefault ? '#9ca3af' : textColor;
          const valueFont = (detail as any).isDefault ? 'Helvetica-Oblique' : 'Helvetica';
          const displayValue = shouldDisplay 
            ? ((detail as any).isDefault ? `${detail.value} (standard default)` : detail.value)
            : defaultDial2Text;
          doc.fillColor(valueColor)
            .font(valueFont)
            .text(
              displayValue,
              260,
              yPos,
              { width: 295, align: 'left' }
            );
        }
        yPos += rowHeight;
      });

      yPos += 20;

      // Items to be Collected Section - Always start on a new page
      doc.addPage();
      yPos = 40;

      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('ITEMS TO BE COLLECTED', 40, yPos);
      
      yPos += 25;
      doc.moveTo(40, yPos).lineTo(555, yPos).stroke(primaryColor);
      yPos += 15;

      if (data.items && data.items.length > 0) {
        // Table header with background
        doc.rect(40, yPos, 515, 25)
          .fill(primaryColor);
        
        doc.fillColor('#ffffff')
          .fontSize(10)
          .font('Helvetica-Bold')
          .text('Category', 50, yPos + 8, { width: 400 });
        doc.text('Quantity', 450, yPos + 8, { width: 105 });
        
        yPos += 30;
        doc.fillColor(textColor);

        // Table rows
        data.items.forEach((item, index) => {
          if (yPos > 720) {
            doc.addPage();
            yPos = 40;
            // Redraw header on new page
            doc.rect(40, yPos, 515, 25).fill(primaryColor);
            doc.fillColor('#ffffff')
              .fontSize(10)
              .font('Helvetica-Bold')
              .text('Category', 50, yPos + 8, { width: 400 });
            doc.text('Quantity', 450, yPos + 8, { width: 105 });
            yPos += 30;
          doc.fillColor(textColor);
          }

          const bgColor = index % 2 === 0 ? lightGray : '#ffffff';
          
          const rowHeight = doc.heightOfString(item.categoryName, { width: 400 }) + 15;

          // Draw row background
          doc.rect(40, yPos - 5, 515, rowHeight)
            .fill(bgColor)
            .stroke(borderColor);

          // Explicitly set fill color to text color for all text elements
          doc.fillColor(textColor)
            .fontSize(10)
            .font('Helvetica')
            .text(item.categoryName, 50, yPos, { width: 400 });
          
          doc.fillColor(textColor)
            .font('Helvetica-Bold')
            .text(item.quantity.toString(), 450, yPos, { width: 105 });
          
          yPos += rowHeight;
        });
      } else {
        doc
          .fontSize(10)
          .font('Helvetica')
          .fillColor('#9ca3af')
          .text('No assets were recorded for this job at the time of collection.', 50, yPos, {
            width: 505,
          });
        yPos += 20;
      }

      yPos += 20;

      // UK GDPR CONTRACT AND TRANSFER OF CUSTODY Section - Always start on a new page
      doc.addPage();
      yPos = 40;

      // Heading text
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('UK GDPR CONTRACT AND TRANSFER OF CUSTODY', 40, yPos);

      // Calculate heading height to position line correctly
      const headingHeight = doc.heightOfString('UK GDPR CONTRACT AND TRANSFER OF CUSTODY', { width: 515 });
      yPos += headingHeight + 10; // Spacing after heading text (10px gap)
      
      // Add bold line below heading
      doc.strokeColor(primaryColor)
        .lineWidth(1.5)
        .moveTo(40, yPos)
        .lineTo(555, yPos)
        .stroke();
      
      yPos += 8; // Minimal spacing - text should be at the bottom of the line

      // Structured terms with main points and sub-points
      const formattedTerms = [
        {
          main: '1) You are guaranteeing (to the best of your knowledge) all equipment is properly available for import into and/or sale within the European Economic Area ("EEA").',
          sub: []
        },
        {
          main: '2) Seller represents and warrants that it has free and clear title to all items sold to Reuse Technology Group Ltd UNDER THIS PURCHASE ORDER.',
          sub: []
        },
        {
          main: '3) Reuse Technology Group Ltd Purchase Order Terms and Conditions shall govern all purchases by Reuse Technology Group Ltd.',
          sub: []
        },
        {
          main: '4) You are legally transferring custody of the equipment on this PO and/or accompanying waste transfer note to Reuse Technology Group Ltd.',
          sub: []
        },
        {
          main: '5) Legal transfer of custody takes place:',
          sub: [
            'a) When you deliver to us and offload the items in our warehouse and sign and date this PO; or',
            'b) When we collect, and you sign and date this PO once items have been loaded onto our vehicle.'
          ]
        },
        {
          main: '6) All magnetic HDD will be sanitised with a sanitisation software which meets ADISA 8.0 STANDARDS unless clearly otherwise stated as a contract comment.',
          sub: []
        },
        {
          main: '7) All SSD drives will be sanitised with a sanitisation software which meets ADISA 8.0 STANDARDS.',
          sub: []
        },
        {
          main: '8) All HDD which show exceptions or failures will have the circuit boards taken off and separated from the HDD.',
          sub: []
        },
        {
          main: '9) All failed Hard Drives, or on Client request, which are sent downstream for shredding:',
          sub: [
            'a) Will always have their circuit board removed and then the platters are crushed at Reuse facilities using a Crusher.',
            'b) They are then taken down to a downstream partner for shredding. No data bearing assets are sent downstream from this facility without being destroyed first onsite.'
          ]
        },
        {
          main: '10) Reuse will only use our own GPS tracked, solid sides and bulkhead vehicles and vetted drivers. No third party logistics will be used.',
          sub: []
        },
        {
          main: '11) Reuse has in place £1 million data protection liability cover.',
          sub: []
        },
        {
          main: '12) As part of this agreement where Reuse Technology Group Ltd is your designated service provider to deliver your IT Asset Disposal, Data Sanitisation, auditing (make, model, serial no, client asset tag....) and Recycling our designation in this case will be as Data Processor on a project by project basis where there is an agreement in place.',
          sub: []
        },
      ];

      formattedTerms.forEach((termObj) => {
        // Calculate actual content height
        doc.fontSize(10).font('Helvetica-Bold');
        const mainHeight = doc.heightOfString(termObj.main, { width: 505 });
        
        let subHeight = 0;
        if (termObj.sub.length > 0) {
          doc.fontSize(9).font('Helvetica');
          subHeight = termObj.sub.reduce((sum, sub) => {
            const subTextHeight = doc.heightOfString(sub, { width: 485 });
            return sum + subTextHeight + 4; // Minimal spacing between sub-points
          }, 0);
        }
        
        // Total content height
        const totalHeight = mainHeight + subHeight;

        if (yPos + totalHeight > 720) {
          doc.addPage();
          yPos = 40;
        }
        doc.fontSize(10)
          .font('Helvetica-Bold')
          .fillColor(textColor)
          .text(termObj.main, 50, yPos, { 
            width: 505, 
            align: 'left',
            lineGap: 3,
            paragraphGap: 0
          });
        
        yPos += mainHeight + 5; // Minimal spacing after main term

        // Sub-points (indented, regular font, smaller size)
        if (termObj.sub.length > 0) {
          termObj.sub.forEach((sub) => {
            doc.fontSize(9)
              .font('Helvetica')
              .fillColor('#374151')
              .text(sub, 70, yPos, { 
                width: 485, 
                align: 'left',
                lineGap: 2,
                paragraphGap: 0
              });
            yPos += doc.heightOfString(sub, { width: 485 }) + 4; // Minimal spacing between sub-points
          });
        }
        
        yPos += 6; // Minimal spacing between terms
      });

      // Add footer to all pages after all content is written
      const pageRange = doc.bufferedPageRange();
      const totalPages = pageRange.count;
      const jobNumber = data.erpJobNumber || '';
      const generatedDate = new Date().toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        
        // Get actual page dimensions
        const pageHeight = doc.page.height;
        const pageWidth = doc.page.width;
        const bottomMargin = 40; // Match the document margin
        const footerY = pageHeight - bottomMargin - 10; // 10px from bottom margin
        const dividerY = pageHeight - bottomMargin - 25; // 25px from bottom margin
        
        // Subtle divider line above footer
        doc.fillColor(borderColor)
          .rect(40, dividerY, pageWidth - 80, 1)
          .fill();

        // Footer text - positioned at the bottom of the page
        const footerText = jobNumber 
          ? `Job: ${jobNumber} | Generated on ${generatedDate} by Reuse Connect ITAD Platform | Page ${i + 1} of ${totalPages}`
          : `Generated on ${generatedDate} by Reuse Connect ITAD Platform | Page ${i + 1} of ${totalPages}`;
        doc.fontSize(7)
          .font('Helvetica')
          .fillColor('#6b7280')
          .text(
            footerText,
            40,
            footerY,
            {
              width: pageWidth - 80,
              align: 'center',
            }
          );
      }

      // End the document - this will finalize the PDF
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Prepare Chain of Custody data from Job, Booking, and related entities
 */
export async function prepareChainOfCustodyData(
  job: any // Using any to avoid complex type definitions - job includes all relations
): Promise<ChainOfCustodyData> {
  const booking = job.booking;
  const driver = job.driver;
  const site = booking?.site;
  const client = booking?.client;


  // Get collection date from job status history or current date
  const collectionDate = job.statusHistory?.find((h: any) => h.status === 'collected')?.createdAt 
    || new Date();

  // Get driver name
  const driverName = driver?.name || booking?.driverName || '';

  // Get vehicle registration from driver profile
  const vehicleReg = driver?.vehicle?.vehicleReg || '';

  // Get site information
  const siteName = booking?.siteName || site?.name || '';
  const sitePostcode = booking?.postcode || site?.postcode || '';
  const siteContactName = site?.contactName || booking?.siteName || '';

  // Get items from job assets
  const items = job.assets?.map((asset: any) => ({
    categoryName: asset.categoryName || asset.category?.name || 'Unknown',
    quantity: asset.quantity,
    serialNumbers: asset.serialNumbers || [],
  })) || [];

  // Get client information
  const clientName = booking?.clientName || client?.name || '';
  const organisationName = client?.organisationName || '';

  return {
    collectionDate: new Date(collectionDate),
    driverName,
    siteName,
    sitePostcode,
    siteContactName,
    vehicleReg,
    items,
    erpJobNumber: job.erpJobNumber || undefined,
    bookingNumber: booking?.bookingNumber || '',
    clientName,
    organisationName: organisationName || undefined,
    // Collection details - these are entered by driver in "routed" status
    // Read directly from job fields (stored in Job table)
    // Use explicit null check to preserve all values including empty strings
    dial2Collection: job.dial2Collection != null ? String(job.dial2Collection) : undefined,
    securityRequirements: job.securityRequirements != null ? String(job.securityRequirements) : undefined,
    idRequired: job.idRequired != null ? String(job.idRequired) : undefined,
    loadingBayLocation: job.loadingBayLocation != null ? String(job.loadingBayLocation) : undefined,
    vehicleHeightRestrictions: job.vehicleHeightRestrictions != null ? String(job.vehicleHeightRestrictions) : undefined,
    doorLiftSize: job.doorLiftSize != null ? String(job.doorLiftSize) : undefined,
    roadWorksPublicEvents: job.roadWorksPublicEvents != null ? String(job.roadWorksPublicEvents) : undefined,
    manualHandlingRequirements: job.manualHandlingRequirements != null ? String(job.manualHandlingRequirements) : undefined,
  };
}
