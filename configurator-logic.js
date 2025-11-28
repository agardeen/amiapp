export function initializeConfigurator(config) {
    const { productName, firestoreDocId, priceFields, baseSection = 'Base' } = config;

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
                selectFrameColorDefaults: false,
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
                orderTimestamp: null,
                userIpAddress: null,
            };
        },
        computed: {
            // Use the first price field as the default for single-price display
            priceField() { return priceFields[0] },
            baseProducts() {
                if (this.isLoading) return [];
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
            frameColorControl() {
                return this.conditionalControls.find(c => c.id === 'Frame Color');
            },
            otherConditionalControls() {
                return this.conditionalControls.filter(c => c.section !== 'Frame Color');
            },
            conditionalControls() {
                if (!this.selectedBase) return [];
                const selectedItemCodes = new Set(this.finalConfigurationItems.map(item => item.ITEM));
                const baseCode = this.selectedBase.Base;
                const relevantRows = this.tableData.filter(row => row.Section !== baseSection && ((row.Base && row.Base.includes(baseCode)) || !row.Base));
                const isRequirementMet = (row) => {
                    if (!row.Requires) return true;
                    return row.Requires.split(/[\s,]+/).some(req => req && selectedItemCodes.has(req.trim()));
                };
                const finalControls = [];
                const processedSections = new Set();
                for (const row of relevantRows) {
                    if (row.Control === 'CB' && isRequirementMet(row)) {
                        finalControls.push({
                            id: row.ID,
                            section: row.Section,
                            label: `${row.ITEM} - ${row.DESCRIPTION}`,
                            controlType: 'CB',
                            price: row[this.priceField]
                        });
                    } else if ((row.Control === 'DDR' || row.Control === 'DD')) {
                        if (processedSections.has(row.Section)) continue;
                        const availableOptions = relevantRows.filter(r => r.Section === row.Section && (r.Control === 'DDR' || r.Control === 'DD') && isRequirementMet(r));
                        if (availableOptions.length > 0) {
                            finalControls.push({
                                id: row.Section,
                                section: row.Section,
                                label: relevantRows.find(r => r.Section === row.Section && r.Control === 'Lable')?.DESCRIPTION || row.Section,
                                options: availableOptions,
                                controlType: row.Control
                            });
                            processedSections.add(row.Section);
                        }
                    }
                }
                return finalControls;
            },
            priceColumnHeaders() {
                if (!this.tableHeaders.length) return [];
                const headersToExclude = ['id'];
                // Ensure tableHeaders is an array before filtering
                return (Array.isArray(this.tableHeaders) ? this.tableHeaders : []).filter(header => {
                    if (headersToExclude.includes(header.toLowerCase())) return false;
                    if (header.toLowerCase().includes('msrp')) return true;
                    return this.tableData.every(row => {
                        const value = row[header];
                        return value === null || value === undefined || String(value).trim() === '' || !isNaN(Number(value));
                    });
                });
            }
        },
        methods: {
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
                this.selectedBaseId = '';
                this.formSelections = {};
                this.selectFrameColorDefaults = false;
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
                if (controlId === 'Z201') return this.formSelections['Z25'];
                if (controlId === 'Z202') return this.formSelections['Z26'];
                return false;
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
                // Gracefully handle if this method is called on a page without multi-price support
                if (!this.finalConfigurationItems) return 0;
                return this.finalConfigurationItems.reduce((total, item) => total + (parseFloat(item[header]) || 0), 0);
            },
            getCheckboxPrice(control, header) {
                // Gracefully handle if this method is called on a page without multi-price support
                const item = this.tableData.find(p => p.ID === control.id);
                return item ? (item[header] || 0) : 0;
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
        },
        watch: {
            isColumnDropdownOpen(isOpen) {
                if (isOpen) document.addEventListener('click', this.handleClickOutside);
                else document.removeEventListener('click', this.handleClickOutside);
            },
            isPriceColumnDropdownOpen(isOpen) {
                if (isOpen) document.addEventListener('click', this.handlePriceClickOutside);
                // The handler might not exist on simpler pages, so check before removing.
                else if (this.handlePriceClickOutside) document.removeEventListener('click', this.handlePriceClickOutside);
            },
            activeTab(newTab) {
                if (newTab === 'my-builds') this.fetchSavedBuilds();
            },
            formSelections: {
                handler(newSelections) {
                    if (newSelections['Z25']) this.formSelections['Z201'] = true;
                    if (newSelections['Z26']) this.formSelections['Z202'] = true;
                },
                deep: true
            },
            selectFrameColorDefaults(isDefaultsSelected) {
                if (isDefaultsSelected) {
                    for (const control of this.conditionalControls) {
                        if (control.controlType === 'DDR') {
                            const defaultOption = control.options.find(opt => opt.Notes && opt.Notes.includes('Default'));
                            if (defaultOption) this.formSelections[control.id] = defaultOption.ID;
                        }
                    }
                }
            },
            conditionalControls(newControls) {
                for (const control of newControls) {
                    // Only initialize a control if it doesn't already have a value.
                    // This prevents the watcher from overwriting loaded data.
                    if ((control.controlType === 'DDR' || control.controlType === 'DD') && !(control.id in this.formSelections)) {
                        this.formSelections[control.id] = ''; // Initialize with an empty string
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
                // Check if the price column selector ref exists before using it.
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