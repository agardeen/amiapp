export function initializeConfigurator(config) {
    const {
        productName,
        firestoreDocId,
        priceFields,
        baseSection = 'Base',
        specialControlIds = {}, // e.g., { extraTall: 'PNG50377' }
        mergedSections = {},   // e.g., { 'Front Frame': ['Shadow Tray Frame', 'Column Frame', ...] }
    } = config;

    Vue.createApp({
        template: '#order-form-template',
        data() {
            return {
                settingsStorageKey: `configuratorSettings_${productName}`,
                activeTab: 'configuration',
                internalTableHeaders: [],
                tableData: [],
                isLoading: true,
                error: null,
                selectedBaseId: '',
                formSelections: {},
                selectDefaults: false,
                extraTallCheckbox: null, // Will hold the PNG50377 control object if it's visible
                hoveredControlId: null,
                isSpecialOrder: false,
                selectedTableHeaders: [], // This will be loaded from settings
                isColumnDropdownOpen: false,
                internalSelectedPriceHeaders: priceFields,
                isPriceScheduleDropdownOpen: false,
                dragData: {
                    draggedIndex: null,
                    draggedOverIndex: null,
                },
                isLoggedIn: false,
                savedBuilds: [],
                currentUser: null,
                currentUserDoc: null,
                itemListBaseFilter: '',
                orderTimestamp: null,
                userIpAddress: null,
                overheadCosts: 0,
                showCosts: false,
                shipping: 0,
                duties: 0,
                tax: 0,
                delivery: 0,
                baseDiscount: 0,
                secondaryDiscount: 0,
                markup: 0,
                fx: 0,
                currencySymbol: '$',
                secondaryDiscountSource: '',
                costBasisSource: 'Cost', // The price schedule to use for cost calculations
                secondaryDiscountName: '',
                savedDiscountProfiles: [],
                profileToManageId: '', // For the new management dropdown
                marginDisplayState: {}, // To track display mode for each header ('percentage' or 'amount')
            };
        },
        computed: {
            // Use the first price field as the default for single-price display
            tableHeaders() {
                if (!this.internalTableHeaders || !this.internalTableHeaders.length) return [];
                // Exclude 'Cost' from the general-purpose table header list.
                return this.internalTableHeaders.filter(h => h.toLowerCase() !== 'cost');
            },
            priceField() { return priceFields[0] },
            baseProducts() {
                if (this.isLoading) return [];
                // Only include items from the baseSection that are actual selectable dropdown options.
                return this.tableData.filter(p => p.Section === baseSection);
            },
            filteredTableData() {
                if (!this.itemListBaseFilter) return this.tableData;
                return this.tableData.filter(row => row.Base && row.Base.split(',').map(b => b.trim()).includes(this.itemListBaseFilter));
            },
            selectedBase() {
                if (!this.selectedBaseId) return null;
                return this.tableData.find(p => p.ID === this.selectedBaseId);
            },
            selectedOptions() {
                const selections = {};
                for (const section in this.formSelections) {
                    const selectedId = this.formSelections[section];
                    if (selectedId) {
                        const selectedObject = this.tableData.find(p => p.ID === selectedId);
                        if (selectedObject) selections[section] = selectedObject;
                    }
                }
                return selections;
            },
            finalConfigurationItems() {
                const items = [];
                if (this.selectedBase) items.push(this.selectedBase);
                for (const key in this.formSelections) {
                    const value = this.formSelections[key];
                    if (!value) continue;
                    let selectedItem = null;
                    if (typeof value === 'string') selectedItem = this.tableData.find(p => p.ID === value);
                    else if (value === true) selectedItem = this.tableData.find(p => p.ID === key);
                    if (selectedItem) items.push(selectedItem);
                }
                return items;
            },
            totalPrice() {
                return this.finalConfigurationItems.reduce((total, item) => total + (parseFloat(item[priceField]) || 0), 0);
            },
            isFormInvalid() {
                if (!this.selectedBaseId) return true;
                for (const control of this.conditionalControls) {
                    if (control.controlType === 'DDR' && !this.formSelections[control.id]) return true;
                }
                if (this.isPatternRequired && !this.formSelections['Pattern']) return true;
                return false;
            },
            isPatternRequired() {
                return this.finalConfigurationItems.some(item => item.DESCRIPTION.includes('Hygienic'));
            },
            priceColumnHeaders() {
                if (!this.internalTableHeaders.length) return [];
                const headersToExclude = ['id'];
                
                // Start with the price-like columns from the original data.
                const basePriceHeaders = (Array.isArray(this.internalTableHeaders) ? this.internalTableHeaders : []).filter(header => {
                    if (headersToExclude.includes(header.toLowerCase())) return false;
                    if (header.toLowerCase() === 'cost') return this.showCosts;
                    if (header.toLowerCase().includes('msrp')) return true;
                    return this.tableData.some(row => row[header]) && this.tableData.every(row => {
                        const value = row[header];
                        return value === null || value === undefined || String(value).trim() === '' || !isNaN(Number(value));
                    });
                });

                // Add the names of saved discount profiles to the list of available columns.
                const discountProfileNames = this.savedDiscountProfiles.map(p => p.discountName);
                
                let allHeaders = [...new Set([...basePriceHeaders, ...discountProfileNames])];

                // If showCosts is enabled, ensure 'Cost' is in the list, but only once.
                // The actual data source for 'Cost' will be handled by `getDataRow`.
                allHeaders = allHeaders.filter(h => h !== 'Cost'); // Remove any existing 'Cost'
                if (this.showCosts) allHeaders.push('Cost');

                return allHeaders;
            },
            selectedPriceHeaders: {
                get() {
                    const availableHeaders = new Set(this.priceColumnHeaders);
                    // Ensure loaded headers from settings are valid before returning
                    const validHeaders = this.internalSelectedPriceHeaders.filter(h => availableHeaders.has(h));
                    if (validHeaders.length === 0 && availableHeaders.size > 0) {
                        return priceFields; // Fallback to default if saved headers are invalid/empty
                    }
                    return validHeaders;
                },
                set(newValue) {
                    this.internalSelectedPriceHeaders = newValue;
                }
            },
            conditionalControls() {
                if (!this.selectedBase) {
                    return [];
                }
        
                const baseItemCode = this.selectedBase.ITEM;
        
                // 1. Filter for relevant rows.
                // A row is relevant if its 'Base' column is empty (global) or contains the selected base's ITEM code.
                const relevantRows = this.tableData.filter(row => {
                    if (row.Section === baseSection || !row.CntlGrp) return false; // Exclude base frames and items that can't be controls.
                    return !row.Base || row.Base.split(',').map(b => b.trim()).includes(baseItemCode);
                });
        
                const controls = [];
                const processedGroups = new Set();
        
                // 2. Build control objects from the relevant rows.
                for (const row of relevantRows) {
                    const isDropdown = row.Control === 'DDR' || row.Control === 'DD';
                    const groupKey = isDropdown ? row.CntlGrp : row.ID;
        
                    if (processedGroups.has(groupKey)) continue;
        
                    if (row.Control === 'DDR' || row.Control === 'DD') {
                        const options = relevantRows.filter(o => o.CntlGrp === row.CntlGrp && (o.Control === 'DDR' || o.Control === 'DD'));

                        // A group is considered 'required' (DDR) if at least one of its options is DDR.
                        const isRequired = options.some(o => o.Control === 'DDR');

                        if (options.length > 0) {
                            controls.push({ id: row.CntlGrp, label: row.CntlGrp, controlType: isRequired ? 'DDR' : 'DD', options: options, section: row.CntlGrp });
                            processedGroups.add(row.CntlGrp);
                        }
                    } else if (row.Control === 'CB' || row.Control === 'CBR') {
                        // Checkboxes become individual controls.
                        controls.push({ id: row.ID, label: row.ITEM ? `${row.ITEM} - ${row.DESCRIPTION}` : row.DESCRIPTION, controlType: row.Control, price: row.price, notes: row.Notes, link: row.Link, section: row.CntlGrp });
                        processedGroups.add(row.ID);
                    }
                }
                return controls;
            },
        },
        methods: {
            getDataRow(row, header) {
                if (header === 'Cost') {
                    // If the requested header is 'Cost', get the value from the selected cost basis source.
                    return row[this.costBasisSource];
                }
                return row[header];
            },
            saveSettings() {
                const settings = {
                    isSpecialOrder: this.isSpecialOrder,
                    selectedTableHeaders: this.selectedTableHeaders,
                    internalSelectedPriceHeaders: this.internalSelectedPriceHeaders,
                    baseDiscount: this.baseDiscount,
                    secondaryDiscount: this.secondaryDiscount,
                    markup: this.markup,
                    fx: this.fx,
                    currencySymbol: this.currencySymbol,
                    costBasisSource: this.costBasisSource,
                    secondaryDiscountSource: this.secondaryDiscountSource,
                    secondaryDiscountName: this.secondaryDiscountName,
                    showCosts: this.showCosts,
                    overheadCosts: this.overheadCosts,
                    shipping: this.shipping,
                    duties: this.duties,
                    tax: this.tax,
                    delivery: this.delivery,
                };
                localStorage.setItem(this.settingsStorageKey, JSON.stringify(settings));
            },
            loadSettings() {
                const savedSettings = localStorage.getItem(this.settingsStorageKey);
                if (savedSettings) {
                    const settings = JSON.parse(savedSettings);
                    this.isSpecialOrder = settings.isSpecialOrder ?? false;
                    this.selectedTableHeaders = Array.isArray(settings.selectedTableHeaders) ? settings.selectedTableHeaders : this.internalTableHeaders;
                    this.internalSelectedPriceHeaders = Array.isArray(settings.internalSelectedPriceHeaders) ? settings.internalSelectedPriceHeaders : priceFields;
                    this.baseDiscount = settings.baseDiscount ?? 0;
                    this.secondaryDiscount = settings.secondaryDiscount ?? 0;
                    this.markup = settings.markup ?? 0;
                    this.fx = settings.fx ?? 0;
                    this.costBasisSource = settings.costBasisSource ?? 'Cost';
                    this.currencySymbol = settings.currencySymbol ?? '$';
                    this.secondaryDiscountSource = settings.secondaryDiscountSource ?? '';
                    this.showCosts = settings.showCosts ?? false;
                    this.overheadCosts = settings.overheadCosts ?? 0;
                    this.shipping = settings.shipping ?? 0;
                    this.duties = settings.duties ?? 0;
                    this.tax = settings.tax ?? 0;
                    this.delivery = settings.delivery ?? 0;
                }
            },
            async fetchDiscountProfiles() {
                const user = firebase.auth().currentUser;
                if (!user) {
                    this.savedDiscountProfiles = [];
                    return;
                }
                try {
                    const snapshot = await db.collection("discount_profiles")
                        .where("ownerId", "==", user.uid)
                        .where("productName", "==", productName)
                        .orderBy("createdAt", "desc")
                        .get();
                    
                    this.savedDiscountProfiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                } catch (error) {
                    console.error("Error fetching discount profiles:", error);
                    // This error often indicates a missing Firestore index. The console will have a link to create it.
                    alert("Could not fetch your saved discount profiles. A required database index might be missing. Check the developer console for a link to create it.");
                }
            },
            async createPriceSchedule() {
                const user = firebase.auth().currentUser;
                if (!user) {
                    alert("Please log in to create a Price Schedule.");
                    return;
                }

                if (!this.secondaryDiscountName.trim()) {
                    alert("Please enter a Price Schedule Name.");
                    return;
                }
                if (!this.secondaryDiscountSource) {
                    alert("Please select a Price Schedule.");
                    return;
                }
            
                const newColumnName = this.secondaryDiscountName.trim();
                const existingProfile = this.savedDiscountProfiles.find(p => p.discountName === newColumnName);

                try {
                    if (existingProfile) {
                        // A profile with this name already exists.
                        if (confirm(`A Price Schedule named "${newColumnName}" already exists. Do you want to replace it?`)) {
                            // User chose to REPLACE.
                            const profileToUpdate = {
                                baseDiscount: this.baseDiscount || 0,
                                secondaryDiscount: this.secondaryDiscount || 0,
                                markup: this.markup || 0,
                                fx: this.fx || 0,
                                sourceColumn: this.secondaryDiscountSource,
                                updatedAt: new Date() // Add an updated timestamp
                            };
                            await db.collection("discount_profiles").doc(existingProfile.id).update(profileToUpdate);
                            alert(`Price Schedule "${newColumnName}" has been updated successfully!`);
                        } else {
                            // User chose to RENAME.
                            alert(`Save cancelled. Please enter a different name for your new Price Schedule.`);
                            return; // Exit without saving.
                        }
                    } else {
                        // No existing profile, so CREATE a new one.
                        const newDiscountProfile = {
                            ownerId: user.uid,
                            companyId: this.currentUserDoc?.companyId || '',
                            productName: productName,
                            discountName: newColumnName,
                            baseDiscount: this.baseDiscount || 0,
                            secondaryDiscount: this.secondaryDiscount || 0,
                            markup: this.markup || 0,
                            fx: this.fx || 0,
                            sourceColumn: this.secondaryDiscountSource,
                            createdAt: new Date(),
                        };
                        await db.collection("discount_profiles").add(newDiscountProfile);
                        alert(`Price Schedule "${newColumnName}" has been saved successfully!`);
                    }

                    // --- BEGIN: Apply the new discount immediately ---
                    const baseDiscountRate = 1 - ((this.baseDiscount || 0) / 100);
                    const secondaryDiscountRate = 1 - ((this.secondaryDiscount || 0) / 100);
                    const markupRate = 1 + ((this.markup || 0) / 100);
                    const fxRate = this.fx || 1; // Default to 1 if fx is 0 or undefined
                    this.tableData.forEach(row => {
                        const sourcePrice = parseFloat(row[this.secondaryDiscountSource]) || 0;
                        row[newColumnName] = (sourcePrice * baseDiscountRate * secondaryDiscountRate * markupRate * fxRate).toFixed(2);
                    });
                    if (!this.internalSelectedPriceHeaders.includes(newColumnName)) {
                        this.internalSelectedPriceHeaders.push(newColumnName);
                    }
                    // --- END: Apply the new discount immediately ---

                    await this.fetchDiscountProfiles(); // Refresh the list of profiles
                } catch (error) {
                    console.error("Error saving Price Schedule:", error);
                    alert("There was an error saving your Price Schedule.");
                }
            },
            async renamePriceSchedule() {
                if (!this.profileToManageId) {
                    alert("Please select a Price Schedule to rename.");
                    return;
                }
                const profile = this.savedDiscountProfiles.find(p => p.id === this.profileToManageId);
                if (!profile) return;

                const newName = prompt(`Enter a new name for "${profile.discountName}":`, profile.discountName);

                if (newName && newName.trim() !== '' && newName !== profile.discountName) {
                    try {
                        await db.collection("discount_profiles").doc(this.profileToManageId).update({ discountName: newName.trim() });
                        alert("Price Schedule renamed successfully.");
                        // Update the name in the selected headers if it's currently displayed
                        const headerIndex = this.internalSelectedPriceHeaders.indexOf(profile.discountName);
                        if (headerIndex > -1) {
                            this.internalSelectedPriceHeaders.splice(headerIndex, 1, newName.trim());
                        }
                        await this.fetchDiscountProfiles();
                    } catch (error) {
                        console.error("Error renaming Price Schedule:", error);
                        alert("Failed to rename Price Schedule.");
                    }
                }
            },
            async deletePriceSchedule() {
                if (!this.profileToManageId) {
                    alert("Please select a Price Schedule to delete.");
                    return;
                }
                const profile = this.savedDiscountProfiles.find(p => p.id === this.profileToManageId);
                if (!profile || !confirm(`Are you sure you want to delete the "${profile.discountName}" profile? This cannot be undone.`)) return;

                await db.collection("discount_profiles").doc(this.profileToManageId).delete();
                alert("Price Schedule deleted successfully.");
                this.internalSelectedPriceHeaders = this.internalSelectedPriceHeaders.filter(h => h !== profile.discountName);
                this.profileToManageId = ''; // Reset selection
                await this.fetchDiscountProfiles();
            },
            applyDefaults() {
                if (!this.selectedBase) return;

                // This logic is moved from the watcher to be called explicitly.
                // It ensures that defaults are applied only when the new base is set.
                const baseCode = this.selectedBase.ITEM;
                const relevantRows = this.tableData.filter(row => !row.Base || row.Base.split(',').map(b => b.trim()).includes(baseCode));
        
                for (const row of relevantRows) {
                    if (!row.Notes || !row.Notes.includes('Default')) continue;
        
                    if (row.Control === 'DDR' || row.Control === 'DD') {
                        this.formSelections[row.CntlGrp] = row.ID;
                    } else if (row.Control === 'CB' || row.Control === 'CBR') { // CBR is a required checkbox
                        this.formSelections[row.ID] = true;
                    }
                }
            },
            getColumnClass(header) {
                switch (header) {
                    case 'DESCRIPTION': return 'col-wide';
                    case 'ID': case 'Control': case 'Base': case 'ITEM': return 'col-narrow';
                    default: return '';
                }
            },
            async setOrderDetails() {
                this.orderTimestamp = new Date().toISOString();
                try {
                    const response = await fetch('https://api.ipify.org?format=json');
                    const data = await response.json();
                    this.userIpAddress = data.ip;
                } catch (error) {
                    console.error('Could not fetch IP address:', error);
                    this.userIpAddress = 'IP fetch error';
                }
            },
            async fetchProductData() {
                this.isLoading = true;
                this.error = null;
                try {
                    const docRef = db.collection("product_data").doc(firestoreDocId);
                    const doc = await docRef.get();
                    if (doc.exists) {
                        const productData = doc.data().items;
                        if (productData && productData.length > 0) {
                            this.internalTableHeaders = Object.keys(productData[0]) || [];
                            this.tableData = productData;
                        } else { throw new Error("Product data is empty."); }
                    } else { throw new Error(`No product data found for '${firestoreDocId}' in the database.`); }
                } catch (error) {
                    this.error = `Failed to load product data. Details: ${error.message}`;
                } finally {
                    this.isLoading = false;
                }
            },
            clearConfiguration() {
                // Reload the page to perform a hard reset of the form.
                // This is the most reliable way to clear all state.
                window.location.reload();
            },
            async saveConfiguration() {
                const user = firebase.auth().currentUser;
                if (!user) {
                    alert("Please log in to save your configuration.");
                    window.location.href = `login.html?redirect=${window.location.pathname.split('/').pop()}`;
                    return;
                }

                const orderDetails = {
                    poNumber: document.getElementById('po-number')?.value || '',
                    quoteNumber: document.getElementById('quote-number')?.value || '',
                    accountNumber: document.getElementById('account-number')?.value || '',
                    orderedBy: document.getElementById('ordered-by')?.value || '',
                    supplierCompany: document.getElementById('supplier-company')?.value || '',
                    supplierAddress: document.getElementById('supplier-address')?.value || '',
                    supplierPhone: document.getElementById('supplier-phone')?.value || '',
                    supplierEmail: document.getElementById('supplier-email')?.value || '',
                    payerSource: document.getElementById('payer-source')?.value || '',
                    atpName: document.getElementById('atp-name')?.value || '',
                    shipToName: document.getElementById('ship-to-name')?.value || '',
                    shipToAddress: document.getElementById('ship-to-address')?.value || '',
                    shipToPhone: document.getElementById('ship-to-phone')?.value || '',
                    tagFor: document.getElementById('tag-for')?.value || '',
                };

                const buildName = prompt(`Please enter a name for this build:`, `My ${productName} Build`) || `${productName} Build ${new Date().toLocaleString()}`;
                if (!buildName) return;

                const configToSave = {
                    ownerId: user.uid,
                    productName: productName,
                    configurationName: buildName,
                    companyId: this.currentUserDoc?.companyId || '',
                    configData: {
                        selectedBaseId: this.selectedBaseId,
                        formSelections: this.formSelections,
                        isSpecialOrder: this.isSpecialOrder,
                        orderDetails: orderDetails
                    },
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                try {
                    await db.collection("configurations").add(configToSave);
                    alert(`Configuration "${buildName}" saved successfully!`);
                    this.fetchSavedBuilds();
                } catch (error) {
                    console.error("Error saving configuration: ", error);
                    alert("There was an error saving your configuration.");
                }
            },
            toggleColumnDropdown() {
                this.isColumnDropdownOpen = !this.isColumnDropdownOpen;
            },
            togglePriceScheduleDropdown() {
                this.isPriceScheduleDropdownOpen = !this.isPriceScheduleDropdownOpen;
            },
            submitConfiguration() {
                if (this.isFormInvalid) {
                    alert('Please complete all required fields.');
                    return;
                }
                this.activeTab = 'summary';
            },
            isCheckboxDisabled(controlId) {
                // Use configured special IDs for product-specific rules
                if (specialControlIds.extraTallBase && controlId === specialControlIds.extraTall) {
                    return this.selectedBaseId === specialControlIds.extraTallBase;
                }
                return false;
            },
            loadConfiguration() {
                const user = firebase.auth().currentUser;
                if (!user) {
                    alert("Please log in to load a configuration.");
                    window.location.href = `login.html?redirect=${window.location.pathname.split('/').pop()}`;
                    return;
                }
                this.activeTab = 'my-builds';
            },
            async fetchSavedBuilds() {
                const user = firebase.auth().currentUser;
                if (!user) return;
                try {
                    const snapshot = await db.collection("configurations")
                        .where("ownerId", "==", user.uid)
                        .where("productName", "==", productName)
                        .orderBy("updatedAt", "desc")
                        .get();
                    this.savedBuilds = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                } catch (error) {
                    console.error("Error fetching saved builds: ", error);
                    alert("Could not fetch your saved builds.");
                }
            },
            loadSavedConfiguration(build) {
                if (!build || !build.configData) return;
                this.selectedBaseId = build.configData.selectedBaseId || '';
                this.$nextTick(() => {
                    this.formSelections = build.configData.formSelections || {};
                    this.isSpecialOrder = build.configData.isSpecialOrder || false;

                    const orderDetails = build.configData.orderDetails || {};
                    const fields = ['po-number', 'quote-number', 'account-number', 'ordered-by', 'supplier-company', 'supplier-address', 'supplier-phone', 'supplier-email', 'payer-source', 'atp-name', 'ship-to-name', 'ship-to-address', 'ship-to-phone', 'tag-for'];
                    fields.forEach(id => {
                        const element = document.getElementById(id);
                        if (element) element.value = orderDetails[id.replace(/-./g, x => x[1].toUpperCase())] || '';
                    });
                });
                alert(`Configuration "${build.configurationName}" loaded.`);
                this.activeTab = 'configuration';
            },
            async deleteSavedConfiguration(docId) {
                if (!confirm("Are you sure you want to delete this build? This cannot be undone.")) return;
                try {
                    await db.collection("configurations").doc(docId).delete();
                    alert("Configuration deleted.");
                    this.fetchSavedBuilds();
                } catch (error) {
                    console.error("Error deleting configuration: ", error);
                }
            },
            async promptAndRenameBuild(build) {
                const newName = prompt("Enter a new name for this build:", build.configurationName);
                if (newName && newName !== build.configurationName) {
                    await db.collection("configurations").doc(build.id).update({ configurationName: newName, updatedAt: new Date() });
                    this.fetchSavedBuilds();
                }
            },
            async fetchCurrentUserData(user) {
                if (!user) {
                    this.currentUserDoc = null;
                    return;
                }
                try {
                    const userDocRef = db.collection('users').doc(user.uid);
                    const userDocSnap = await userDocRef.get();
                    if (userDocSnap.exists) {
                        this.currentUserDoc = userDocSnap.data();
                    }
                } catch (error) {
                    console.error("Error fetching current user's data:", error);
                }
            },
            dragStart(index, event) {
                this.dragData.draggedIndex = index;
                event.dataTransfer.effectAllowed = 'move';
            },
            dragOver(index, event) {
                event.preventDefault();
                if (index !== this.dragData.draggedOverIndex) {
                    this.dragData.draggedOverIndex = index;
                    event.target.classList.add('drag-over');
                }
            },
            dragLeave(event) {
                event.target.classList.remove('drag-over');
                this.dragData.draggedOverIndex = null;
            },
            onDrop(dropIndex, event) {
                event.target.classList.remove('drag-over');
                const draggedIndex = this.dragData.draggedIndex;
                if (draggedIndex === null || draggedIndex === dropIndex) return;
                const itemToMove = this.selectedPriceHeaders.splice(draggedIndex, 1)[0];
                this.selectedPriceHeaders.splice(dropIndex, 0, itemToMove);
                this.dragData.draggedIndex = null;
            },
            getHeaderTotal(header) {
                // Gracefully handle if this method is called on a page without multi-price support
                if (!this.finalConfigurationItems) return '0.00';

                let total = this.finalConfigurationItems.reduce((sum, item) => sum + (parseFloat(this.getDataRow(item, header)) || 0), 0);

                // If the column is 'Cost', add the overhead costs.
                if (header === 'Cost') {
                    const itemTotal = total; // The sum of all item costs
                    const dutiesPercentage = parseFloat(this.duties) || 0;
                    const taxPercentage = parseFloat(this.tax) || 0;

                    total += parseFloat(this.overheadCosts) || 0;
                    total += parseFloat(this.shipping) || 0;
                    total += (itemTotal * (dutiesPercentage / 100)); // Add duties as a percentage of item total
                    total += (itemTotal * (taxPercentage / 100)); // Add tax as a percentage of item total
                    total += parseFloat(this.delivery) || 0;
                }

                return total.toFixed(2);
            },
            getMargin(header) {
                const costTotal = parseFloat(this.getHeaderTotal('Cost')) || 0;
                const columnTotal = parseFloat(this.getHeaderTotal(header)) || 0;
                const margin = columnTotal - costTotal;
                return margin.toFixed(2);
            },
            getMarginPercentage(header) {
                const marginValue = parseFloat(this.getMargin(header)) || 0;
                const columnTotal = parseFloat(this.getHeaderTotal(header)) || 0;
                if (columnTotal === 0) {
                    return '0.00%';
                }
                const marginPercentage = (marginValue / columnTotal) * 100;
                return marginPercentage.toFixed(2) + '%';
            },
            getCheckboxPrice(control, header) {
                // Gracefully handle if this method is called on a page without multi-price support
                const item = this.tableData.find(p => p.ID === control.id);
                return item ? (this.getDataRow(item, header) || 0) : 0;
            },
            shouldShowPrice(control) {
                if (control.controlType === 'CB') {
                    // This is for sc.html's multi-price display. It's safe for z1of.html.
                    return this.formSelections[control.id];
                }
                if (control.controlType === 'DDR' || control.controlType === 'DD') {
                    const selectedOpt = this.selectedOptions[control.id];
                    return !!selectedOpt;
                }
                return false;
            },
            toggleMarginDisplay(header) {
                if (this.marginDisplayState[header] === 'percentage') {
                    this.marginDisplayState[header] = 'amount';
                } else {
                    this.marginDisplayState[header] = 'percentage';
                }
            },
        },
        watch: {
            selectedPriceHeaders(newHeaders, oldHeaders) {
                // Ensure margin display state is initialized for new headers
                newHeaders.forEach(header => {
                    if (!this.marginDisplayState[header]) {
                        this.marginDisplayState[header] = 'percentage';
                    }
                });

                // Find newly added headers by comparing the new array with the old one
                const addedHeaders = newHeaders.filter(h => !oldHeaders.includes(h));
                for (const headerName of addedHeaders) {
                    // Check if the newly added header corresponds to a saved discount profile
                    const profile = this.savedDiscountProfiles.find(p => p.discountName === headerName);
                    if (profile) {
                        // If it is, apply the discount calculation to populate the data
                        const baseDiscountRate = 1 - ((profile.baseDiscount || 0) / 100);
                        const secondaryDiscountRate = 1 - ((profile.secondaryDiscount || 0) / 100);
                        const markupRate = 1 + ((profile.markup || 0) / 100);
                        const fxRate = profile.fx || 1; // Default to 1 if fx is 0 or undefined

                        this.tableData.forEach(row => {
                            const sourcePrice = parseFloat(row[profile.sourceColumn]) || 0;
                            row[headerName] = (sourcePrice * baseDiscountRate * secondaryDiscountRate * markupRate * fxRate).toFixed(2);
                        });
                    }
                }

                this.saveSettings();
            },
            isSpecialOrder() { this.saveSettings(); },
            selectedTableHeaders: {
                handler() { this.saveSettings(); },
                deep: true
            },
            internalSelectedPriceHeaders: {
                handler() { this.saveSettings(); },
                deep: true
            },
            baseDiscount() { this.saveSettings(); },
            secondaryDiscount() { this.saveSettings(); },
            markup() { this.saveSettings(); },
            fx() { this.saveSettings(); },
            currencySymbol() { this.saveSettings(); },
            costBasisSource() { this.saveSettings(); },
            showCosts() { this.saveSettings(); },
            overheadCosts() { this.saveSettings(); },
            shipping() { this.saveSettings(); },
            duties() { this.saveSettings(); },
            tax() { this.saveSettings(); },
            delivery() { this.saveSettings(); },
            selectedBaseId(newBaseId) {
                // When the base product changes, we must clear all previous selections
                // to prevent rules from being evaluated against a stale configuration.
                // This is a "hard reset" of the options whenever the base changes.
                const wasDefaultsChecked = this.selectDefaults;
                if (wasDefaultsChecked) {
                    this.selectDefaults = false;
                }

                this.formSelections = {};

                // If defaults were on, re-check the box. The `selectDefaults` watcher will handle applying them.
                if (wasDefaultsChecked) {
                    this.$nextTick(() => { this.selectDefaults = true; });
                }
                if (specialControlIds.extraTall && specialControlIds.extraTallBase) {
                    if (newBaseId === specialControlIds.extraTallBase) {
                        this.formSelections[specialControlIds.extraTall] = true;
                    } else {
                        this.formSelections[specialControlIds.extraTall] = false;
                    }
                }
            },
            isColumnDropdownOpen(isOpen) {
                if (isOpen) document.addEventListener('click', this.handleClickOutside);
                else document.removeEventListener('click', this.handleClickOutside);
            },
            isPriceScheduleDropdownOpen(isOpen) {
                if (isOpen) document.addEventListener('click', this.handlePriceScheduleClickOutside);
                // The handler might not exist on simpler pages, so check before removing.
                else if (this.handlePriceScheduleClickOutside) document.removeEventListener('click', this.handlePriceScheduleClickOutside);
            },
            activeTab(newTab) {
                if (newTab === 'my-builds') this.fetchSavedBuilds();
            },
            formSelections: {
                handler(newSelections) {
                    // Placeholder for future generic, rule-based auto-selections
                },
                deep: true
            },
            selectDefaults(isDefaultsSelected) {
                this.saveSettings();
                // When the checkbox is checked, clear any existing selections and apply the defaults.
                // When unchecked, we do nothing, leaving the user's selections as they are.
                // A full reset can be done with the "Clear" button.
                if (isDefaultsSelected) {
                    this.formSelections = {}; // Clear previous non-default selections
                    this.applyDefaults();
                } 
            },
            conditionalControls(newControls) {
                // When controls are added, ensure required dropdowns (DDR) have their
                // model initialized to an empty string to show the placeholder.
                for (const control of newControls) {
                    if (control.controlType === 'DDR' && !(control.id in this.formSelections)) {
                        this.formSelections[control.id] = '';
                    }
                }
            },
        },
        created() {
            this.handleClickOutside = (event) => {
                if (this.$refs.columnSelector && !this.$refs.columnSelector.contains(event.target)) {
                    this.isColumnDropdownOpen = false;
                }
            };
            this.handlePriceScheduleClickOutside = (event) => {
                // Check if the price column selector ref exists before using it.
                if (this.$refs.priceColumnSelector && !this.$refs.priceColumnSelector.contains(event.target)) {
                    this.isPriceScheduleDropdownOpen = false;
                }
            };

            this.setOrderDetails();
            this.loadSettings(); // Load settings before fetching data
            this.fetchProductData();
            firebase.auth().onAuthStateChanged(user => {
                this.currentUser = user;
                this.isLoggedIn = !!this.currentUser;
                if (this.isLoggedIn) {
                    this.fetchSavedBuilds();
                    this.fetchDiscountProfiles();
                    this.fetchCurrentUserData(user);
                }
            });

            // Initialize margin display state after settings are loaded
            this.internalSelectedPriceHeaders.forEach(header => {
                this.marginDisplayState[header] = 'percentage'; // Default to percentage
            });
        },
    }).mount('#order-form-container');
}