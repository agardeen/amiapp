export function initializeConfigurator(config) {
    const {
        productName,
        firestoreDocId,
        priceFields,
        baseSection = 'Base',
    } = config;

    Vue.createApp({
        template: '#order-form-template',
        data() {
            return {
                activeTab: 'configuration',
                tableHeaders: [],
                tableData: [],
                isLoading: true,
                error: null,
                selectedBaseId: '',
                formSelections: {},
                selectDefaults: false,
                hoveredControlId: null,
                isSpecialOrder: false,
                selectedTableHeaders: [],
                isColumnDropdownOpen: false,
                selectedPriceHeaders: priceFields,
                isPriceColumnDropdownOpen: false,
                dragData: {
                    draggedIndex: null,
                    draggedOverIndex: null,
                },
                isLoggedIn: false,
                savedBuilds: [],
                currentUser: null,
                currentUserDoc: null,
                itemListBaseFilter: '',
                user: {
                    name: '',
                    email: '',
                    company: '',
                    address: '',
                    shippingAddress: '',
                    phone: '',
                    accountNumber: '',
                    country: ''
                },
                orderTimestamp: null,
                userIpAddress: null,
            };
        },
        computed: {
            // Use the first price field as the default for single-price display
            priceField() { return priceFields[0] },
            baseProducts() {
                if (this.isLoading) return [];
                return this.tableData.filter(p => p.CntlGrp === baseSection && (p.Control === 'DDR' || p.Control === 'DD'));
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
                
                // Sort the items in descending order based on the ID column.
                // Using localeCompare ensures correct string sorting.
                // Using { numeric: true } ensures natural sort order (e.g., E2 before E10).
                return items.sort((a, b) => a.ID.localeCompare(b.ID, undefined, { numeric: true }));
            },
            totalPrice() {
                return this.finalConfigurationItems.reduce((total, item) => total + (parseFloat(item[this.priceField]) || 0), 0);
            },
            isFormInvalid() {
                // Simplified for now. You can add more complex validation logic here.
                if (!this.selectedBaseId) return true;
                return false;
            },
            priceColumnHeaders() {
                if (!this.tableHeaders.length) return [];
                const headersToExclude = ['id'];
                return (Array.isArray(this.tableHeaders) ? this.tableHeaders : []).filter(header => {
                    if (headersToExclude.includes(header.toLowerCase())) return false;
                    if (header.toLowerCase().includes('msrp')) return true;
                    return this.tableData.every(row => {
                        const value = row[header];
                        return value === null || value === undefined || String(value).trim() === '' || !isNaN(Number(value));
                    });
                });
            },
            conditionalControls() {
                // THIS IS THE CLEAN SLATE
                // All logic to build your form controls will go here.
                if (!this.selectedBase) {
                    return [];
                }

                // Rule 1: Filter data based on the selected Base product.
                const baseCode = this.selectedBase.Base;
                const relevantRows = this.tableData.filter(row => {
                    // Exclude other base items from the controls list.
                    if (row.CntlGrp === baseSection) return false;
                    // Keep rows that have a blank Base column (global options).
                    if (!row.Base) return true;
                    // Keep rows where the Base column includes the selected base's code.
                    return row.Base.split(',').map(b => b.trim()).includes(baseCode);
                });

                // Rule: "Requires" - Helper function to check if an item's requirements are met.
                const isRequirementMet = (row) => {
                    // If the 'Requires' column is empty, the item is always considered valid.
                    if (!row.Requires) return true;

                    // Get a set of all currently selected ITEM values for efficient lookup.
                    const currentSelections = new Set(this.finalConfigurationItems.map(item => item.ITEM));

                    // Check if at least ONE of the required items is in the current selections (OR logic).
                    return row.Requires.split(',').map(req => req.trim()).some(req => currentSelections.has(req));
                };

                const controls = [];
                const processedGroups = new Set();

                // Process all controls in a single pass to maintain their natural order from the data table.
                for (const row of relevantRows) {
                    // Ignore rows without a CntlGrp or rows that are just labels.
                    if (!row.CntlGrp || row.Control === 'Label') continue;

                    // If we have already created a control for this group, skip to the next row.
                    if (processedGroups.has(row.CntlGrp)) continue;

                    // Handle Dropdowns (DDR, DD) and Radio Buttons (OB)
                    if (row.Control === 'DDR' || row.Control === 'DD' || row.Control === 'OB') {
                        // Find all rows with the same CntlGrp and apply the 'Requires' rule to each option.
                        const options = relevantRows.filter(o => o.CntlGrp === row.CntlGrp && isRequirementMet(o));
                        if (options.length > 0) {
                            controls.push({ id: row.CntlGrp, label: row.CntlGrp, controlType: row.Control, options: options });
                            processedGroups.add(row.CntlGrp);
                        }
                    // Handle Checkboxes (CB, CBR) - one control per row.
                    } else if (row.Control === 'CB' || row.Control === 'CBR') {
                        // A checkbox is only created if it meets the 'Requires' rule.
                        if (isRequirementMet(row)) {
                            const label = row.ITEM ? `${row.ITEM} - ${row.DESCRIPTION}` : row.DESCRIPTION;
                            controls.push({ id: row.ID, label: label, controlType: row.Control, price: row[this.priceField] });
                            processedGroups.add(row.CntlGrp);
                        }
                    }
                }

                return controls;
            },
        },
        methods: {
            async geocodeAddress(address) {
                if (!address || address.trim() === '') return null;
                try {
                    const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`);
                    const data = await response.json();
                    if (data && data.length > 0) {
                        return {
                            lat: parseFloat(data[0].lat),
                            lng: parseFloat(data[0].lon)
                        };
                    }
                    return null;
                } catch (error) {
                    console.error("Geocoding error:", error);
                    return null;
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
                            this.tableHeaders = Object.keys(productData[0]);
                            this.tableData = productData;
                            this.selectedTableHeaders = this.tableHeaders; // Default to showing all columns
                        } else { throw new Error("Product data is empty."); }
                    } else { throw new Error(`No product data found for '${firestoreDocId}' in the database.`); }
                } catch (error) {
                    this.error = `Failed to load product data. Details: ${error.message}`;
                } finally {
                    this.isLoading = false;
                }
            },
            clearConfiguration() {
                // Reset only the data related to the current build configuration.
                // This preserves settings like selected price columns.
                this.selectedBaseId = '';
                this.formSelections = {};
                this.selectDefaults = false;
                // The watcher on conditionalControls will handle re-initializing required fields.
            },
            async saveConfiguration() {
                const user = firebase.auth().currentUser;
                if (!user) {
                    alert("Please log in to save your configuration.");
                    window.location.href = `login.html?redirect=${window.location.pathname.split('/').pop()}`;
                    return;
                }
    
            let buildName;
            let isNameValid = false;
            let existingBuild = null;
    
            while (!isNameValid) {
                buildName = prompt(`Please enter a name for this build:`, `My ${productName} Build`);
    
                if (!buildName) return; // User cancelled the prompt.
    
                existingBuild = this.savedBuilds.find(b => b.configurationName === buildName);
    
                if (existingBuild) {
                    const overwrite = confirm(`A build named "${buildName}" already exists. Do you want to overwrite it?`);
                    if (overwrite) {
                        isNameValid = true; // Proceed to overwrite.
                    }
                    // If user clicks "Cancel", the loop continues, prompting for a new name.
                } else {
                    isNameValid = true; // Name is unique, proceed to save.
                }
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
    
            const configData = {
                selectedBaseId: this.selectedBaseId,
                formSelections: this.formSelections,
                isSpecialOrder: this.isSpecialOrder,
                orderDetails: orderDetails
            };
    
            try {
                if (existingBuild) {
                    // Overwrite existing build
                    const buildRef = db.collection("configurations").doc(existingBuild.id);
                    await buildRef.update({ configData: configData, updatedAt: new Date() });
                    alert(`Configuration "${buildName}" updated successfully!`);
                } else {
                    // Save as new build
                    const newConfig = { ownerId: user.uid, productName: productName, configurationName: buildName, companyId: this.currentUserDoc?.companyId || '', configData: configData, createdAt: new Date(), updatedAt: new Date() };
                    await db.collection("configurations").add(newConfig);
                    alert(`Configuration "${buildName}" saved successfully!`);
                }
                this.fetchSavedBuilds();
            } catch (error) {
                console.error("Error saving configuration: ", error);
                alert("There was an error saving your configuration.");
            }
            },
            async saveUserDetails() {
                if (!this.currentUser) {
                    alert("You must be logged in to save your details.");
                    return;
                }

                const sanitizedPhone = this.user.phone.replace(/[^\d\s-()+]/g, '');
                const addressCoords = await this.geocodeAddress(this.user.address);
                const shippingAddressCoords = await this.geocodeAddress(this.user.shippingAddress);

                try {
                    const userDocRef = db.collection('users').doc(this.currentUser.uid);
                    await userDocRef.set({
                        name: this.user.name,
                        company: this.user.company,
                        address: this.user.address,
                        shippingAddress: this.user.shippingAddress,
                        address_coords: addressCoords,
                        shippingAddress_coords: shippingAddressCoords,
                        phone: sanitizedPhone,
                        accountNumber: this.user.accountNumber,
                        country: this.user.country,
                        email: this.user.email
                    }, { merge: true });
                    alert("Your details have been saved successfully!");
                } catch (error) {
                    console.error("Error saving user details: ", error);
                    alert("There was an error saving your details. Please try again.");
                }
            },
            toggleColumnDropdown() {
                this.isColumnDropdownOpen = !this.isColumnDropdownOpen;
            },
            togglePriceColumnDropdown() {
                this.isPriceColumnDropdownOpen = !this.isPriceColumnDropdownOpen;
            },
            submitConfiguration() {
                if (this.isFormInvalid) {
                    alert('Please complete all required fields.');
                    return;
                }
                this.activeTab = 'summary';
            },
            isCheckboxDisabled(controlId) {
                // Find the corresponding row in the raw data to check its control type.
                const row = this.tableData.find(r => r.ID === controlId);
                // Disable the checkbox if its control type is CBR (CheckBox Required).
                if (row && row.Control === 'CBR') return true;
                return false; // Otherwise, it is not disabled.
            },
            getHoveredItem(control) {
                if (control.id === 'base-product') return this.selectedBase;
                if (control.controlType === 'CB') return this.formSelections[control.id] ? this.tableData.find(p => p.ID === control.id) : null;
                if (control.controlType === 'DDR' || control.controlType === 'DD') return this.selectedOptions[control.id];
                return null;
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
                if (!this.finalConfigurationItems) return 0;
                return this.finalConfigurationItems.reduce((total, item) => total + (parseFloat(item[header]) || 0), 0);
            },
            getCheckboxPrice(control, header) {
                const item = this.tableData.find(p => p.ID === control.id);
                return item ? (item[header] || 0) : 0;
            },
            shouldShowPrice(control) {
                if (control.controlType === 'CB' || control.controlType === 'CBR') {
                    return this.formSelections[control.id];
                }
                if (control.controlType === 'DDR' || control.controlType === 'DD' || control.controlType === 'OB') {
                    const selectedOpt = this.selectedOptions[control.id];
                    return !!selectedOpt;
                }
                return false;
            },
        },
        watch: {
            selectedBaseId(newBaseId) {
                // You can add logic here that runs when the base product changes
            },
            isColumnDropdownOpen(isOpen) {
                if (isOpen) document.addEventListener('click', this.handleClickOutside);
                else document.removeEventListener('click', this.handleClickOutside);
            },
            isPriceColumnDropdownOpen(isOpen) {
                if (isOpen) document.addEventListener('click', this.handlePriceClickOutside);
                else if (this.handlePriceClickOutside) document.removeEventListener('click', this.handlePriceClickOutside);
            },
            activeTab(newTab) {
                if (newTab === 'my-builds') this.fetchSavedBuilds();
            },
            formSelections: {
                handler(newSelections) {
                    // You can add logic here that reacts to any selection change
                },
                deep: true
            },
            currentUserDoc(newDoc) {
                // When user data is loaded, pre-populate the order details form.
                if (newDoc) {
                    this.user.name = newDoc.name || '';
                    this.user.email = newDoc.email || '';
                    this.user.company = newDoc.company || '';
                    this.user.address = newDoc.address || '';
                    this.user.shippingAddress = newDoc.shippingAddress || '';
                    this.user.phone = newDoc.phone || '';
                    this.user.accountNumber = newDoc.accountNumber || '';
                    this.user.country = newDoc.country || '';

                    // Pre-fill from geolocation if needed
                    if (!this.user.country || !this.user.phone) {
                        fetch('https://ipapi.co/json/').then(res => res.json()).then(geoData => {
                            if (!this.user.country) this.user.country = geoData.country_name;
                            if (!this.user.phone) {
                                let phoneCode = geoData.country_calling_code;
                                this.user.phone = phoneCode ? (phoneCode.startsWith('+') ? `${phoneCode} ` : `+${phoneCode} `) : '+1 ';
                            }
                        }).catch(err => console.error('Could not fetch geolocation data:', err));
                    }
                }
            },
            selectDefaults(isDefaultsSelected) {
                if (!isDefaultsSelected) return;

                const applyDefaults = () => {
                    // Iterate through the controls that are currently visible on the screen.
                    for (const control of this.conditionalControls) {
                        // Handle Dropdowns and Radio Buttons
                        if (control.controlType === 'DDR' || control.controlType === 'DD' || control.controlType === 'OB') {
                            // Find the first default option within this control's visible options.
                            const defaultOption = control.options.find(opt => opt.Notes && opt.Notes.includes('Default'));
                            if (defaultOption) {
                                this.formSelections[control.id] = defaultOption.ID;
                            }
                        // Handle Checkboxes
                        } else if (control.controlType === 'CB' || control.controlType === 'CBR') {
                            const row = this.tableData.find(r => r.ID === control.id);
                            if (row && row.Notes && row.Notes.includes('Default')) {
                                this.formSelections[control.id] = true;
                            }
                        }
                    }
                };

                // First Pass: Apply all defaults that are currently visible.
                applyDefaults();

                // Second Pass: Wait for Vue to update the DOM, then run again to catch cascading defaults.
                this.$nextTick(() => {
                    applyDefaults();
                });
            },
            conditionalControls(newControls) {
                // When controls are added, ensure required dropdowns (DDR) have their
                // model initialized to an empty string to show the placeholder.
                for (const control of newControls) {
                    if (control.controlType === 'DDR' && !(control.id in this.formSelections)) {
                        this.formSelections[control.id] = '';
                    }
                    // If a CBR control is created, automatically check it.
                    if (control.controlType === 'CBR') {
                        this.formSelections[control.id] = true;
                    }
                }
            }
        },
        created() {
            this.handleClickOutside = (event) => {
                if (this.$refs.columnSelector && !this.$refs.columnSelector.contains(event.target)) {
                    this.isColumnDropdownOpen = false;
                }
            };
            this.handlePriceClickOutside = (event) => {
                if (this.$refs.priceColumnSelector && !this.$refs.priceColumnSelector.contains(event.target)) {
                    this.isPriceColumnDropdownOpen = false;
                }
            };
            this.setOrderDetails();
            this.fetchProductData();
            firebase.auth().onAuthStateChanged(user => {
                this.currentUser = user;
                this.isLoggedIn = !!this.currentUser;
                if (this.isLoggedIn) {
                    this.fetchSavedBuilds();
                    this.fetchCurrentUserData(user);
                }
            });
        },
    }).mount('#order-form-container');
}