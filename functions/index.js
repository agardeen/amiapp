/**
 * This function uses the 'onRequest' trigger to sync data from a Google Sheet.
 * It is the final, working version.
 */
const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {google} = require("googleapis");

admin.initializeApp();
const db = admin.firestore();

exports.syncSheet = onRequest({timeoutSeconds: 120, memory: '512MiB'}, async (req, res) => {
  // Set CORS headers for preflight and actual requests
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    // Send response to preflight request
    res.status(204).send('');
    return;
  }

  try {
    // 1. Validate Input Data from the request body
    const {sheetId, sheetName, docId} = req.body.data;
    logger.info("Function triggered with data:", {sheetId, sheetName, docId});

    if (!sheetId || !sheetName || !docId) {
      logger.error("Validation Error: Missing required arguments.");
      throw new Error('The function must be called with "sheetId", "sheetName", and "docId".');
    }

    // 2. Authenticate with Google APIs
    logger.info("Authenticating with Google Sheets API using local key file...");
    const auth = new google.auth.GoogleAuth({
      keyFile: "./service-account-key.json", // Path to your key file
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({version: 'v4', auth});
    logger.info("Authentication successful.");

    // 3. Fetch Data from Google Sheet
    logger.info(`Fetching data from sheetId: ${sheetId}, range: ${sheetName}`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetName,
    });
    logger.info("Successfully fetched data from sheet.");

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      throw new Error('No data was found in the Google Sheet. Please check the sheet name and ensure it is not empty.');
    }

    // 4. Process Data
    const headers = rows[0];
    const items = rows.slice(1).map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = row[index] || "";
      });
      return item;
    });

    // 5. Save to Firestore
    logger.info(`Saving ${items.length} items to Firestore document: product_data/${docId}`);
    const docRef = db.collection("product_data").doc(docId);
    await docRef.set({
      headers: headers,
      items: items,
      lastSync: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info("Successfully saved data to Firestore.");

    const successMessage = `Successfully synced ${items.length} items from sheet '${sheetName}'.`;
    res.status(200).json({ data: { success: true, message: successMessage } });

  } catch (error) {
    logger.error("Unhandled Exception during sheet sync:", error);
    res.status(500).json({ data: { success: false, message: error.message } });
  }
});
