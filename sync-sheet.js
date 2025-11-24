// sync-sheet.js

// Import necessary libraries
const { google } = require('googleapis');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// --- CONFIGURATION ---
// Path to your service account key file. This should be in the same directory.
const SERVICE_ACCOUNT_KEY_FILE = './service-account-key.json';

// The ID of your Google Sheet. You can find this in the sheet's URL:
// https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
const SPREADSHEET_ID = '1CDec57RIPeLYhuAYjQWExZqfJeKqGemyftLmSaFMdCM';

// The name of the sheet (tab) within your spreadsheet you want to sync.
// Let's start with the Zing Size 1 data.
const SHEET_NAME = 'Zing1'; // Make sure this matches the tab name in your sheet

// The name of the document to create/update in Firestore's 'product_data' collection.
const FIRESTORE_DOCUMENT_ID = 'zing1';
const PRODUCT_NAME = 'Zing Size 1';
// --- END CONFIGURATION ---


// Initialize Firebase Admin SDK
const serviceAccount = require(SERVICE_ACCOUNT_KEY_FILE);
initializeApp({
  credential: cert(serviceAccount)
});
const db = getFirestore();

// Function to authenticate with Google Sheets
async function getGoogleSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

// Main function to perform the sync
async function syncSheetToFirestore() {
  try {
    console.log('Starting sync...');
    const sheets = await getGoogleSheetsClient();

    // 1. Read data from Google Sheet
    console.log(`Reading from spreadsheet: ${SPREADSHEET_ID}, sheet: ${SHEET_NAME}`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: SHEET_NAME,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      throw new Error('No data found in sheet. It must have a header row and at least one data row.');
    }

    // 2. Convert rows to an array of objects
    const headers = rows[0];
    const dataArray = rows.slice(1).map(row => {
      const rowData = {};
      headers.forEach((header, index) => {
        rowData[header] = row[index] || ''; // Use empty string for empty cells
      });
      return rowData;
    });
    console.log(`Found ${dataArray.length} items to sync.`);

    // 3. Write the data to Firestore
    const docRef = db.collection('product_data').doc(FIRESTORE_DOCUMENT_ID);
    console.log(`Writing to Firestore document: product_data/${FIRESTORE_DOCUMENT_ID}`);
    
    await docRef.set({
      productName: PRODUCT_NAME,
      headers: headers,
      items: dataArray,
      lastSync: new Date()
    });

    console.log('✅ Sync completed successfully!');

  } catch (error) {
    console.error('❌ Error during sync:', error.message);
  }
}

// Run the sync function
syncSheetToFirestore();