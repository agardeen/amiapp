export function initializeUserPage() {
    Vue.createApp({
        template: '#user-profile-template',
        data() {
            return {
                isLoading: true,
                error: null,
                currentUser: null,
                userIpAddress: null,
                user: {
                    name: '',
                    email: '',
                    company: '',
                    address: '',
                    shippingAddress: '',
                    phone: '',
                    accountNumber: '',
                    country: '',
                    address_coords: null,
                    shippingAddress_coords: null
                }
            };
        },
        methods: {
            async geocodeAddress(address) {
                if (!address || address.trim() === '') return null;
                try {
                    // Using Nominatim (OpenStreetMap) for geocoding.
                    // It's free but has usage policies (e.g., max 1 request/sec).
                    const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`);
                    const data = await response.json();
                    if (data && data.length > 0) {
                        return {
                            lat: parseFloat(data[0].lat),
                            lng: parseFloat(data[0].lon)
                        };
                    }
                    return null; // No result found
                } catch (error) {
                    console.error("Geocoding error:", error);
                    return null;
                }
            },
            async fetchUserData(firebaseUser) {
                this.isLoading = true;
                try {
                    const userDocRef = db.collection('users').doc(firebaseUser.uid);
                    const userDocSnap = await userDocRef.get();

                    if (userDocSnap.exists) {
                        const dbUser = userDocSnap.data();
                        this.user.name = dbUser.name || '';
                        this.user.company = dbUser.company || '';
                        this.user.address = dbUser.address || '';
                        this.user.shippingAddress = dbUser.shippingAddress || '';
                        this.user.phone = dbUser.phone || '';
                        this.user.accountNumber = dbUser.accountNumber || '';
                        this.user.country = dbUser.country || '';
                        this.user.address_coords = dbUser.address_coords || null;
                        this.user.shippingAddress_coords = dbUser.shippingAddress_coords || null;
                    }
                    // Always get email from the auth object as the source of truth.
                    this.user.email = firebaseUser.email;

                    // Now, fetch geolocation data.
                    try {
                        const geoResponse = await fetch('https://ipapi.co/json/');
                        const geoData = await geoResponse.json();
                        this.userIpAddress = geoData.ip;

                        // Pre-fill country if it's not already set.
                        if (!this.user.country) this.user.country = geoData.country_name;

                        // Pre-fill phone country code only if the entire phone number is empty.
                        if (!this.user.phone) {
                            let phoneCode = geoData.country_calling_code;
                            if (phoneCode) {
                                // Ensure the code starts with a '+' but doesn't add a second one.
                                this.user.phone = phoneCode.startsWith('+') ? `${phoneCode} ` : `+${phoneCode} `;
                            } else {
                                this.user.phone = '+1 '; // Default if service fails
                            }
                        }
                    } catch (geoError) { console.error('Could not fetch geolocation data:', geoError); }

                } catch (err) {
                    this.error = "Failed to load your user data. Please try again later.";
                    console.error("Error fetching user data:", err);
                } finally {
                    this.isLoading = false;
                }
            },
            async saveUserDetails() {
                if (!this.currentUser) {
                    alert("You must be logged in to save your details.");
                    return;
                }

                // Sanitize the phone number before saving
                const sanitizedPhone = this.user.phone.replace(/[^\d\s-()+]/g, '');

                // Geocode addresses before saving
                const addressCoords = await this.geocodeAddress(this.user.address);
                const shippingAddressCoords = await this.geocodeAddress(this.user.shippingAddress);

                try {
                    const userDocRef = db.collection('users').doc(this.currentUser.uid);
                    // We only save fields that are editable on this page.
                    await userDocRef.set({
                        name: this.user.name,
                        company: this.user.company,
                        address: this.user.address,
                        shippingAddress: this.user.shippingAddress,
                        address_coords: addressCoords,
                        shippingAddress_coords: shippingAddressCoords,
                        phone: sanitizedPhone,
                        accountNumber: this.user.accountNumber,
                        lastKnownIp: this.userIpAddress, // Save the IP address
                        country: this.user.country,
                        email: this.user.email // Keep email in sync
                    }, { merge: true }); // Use merge:true to avoid overwriting other fields

                    alert("Your details have been saved successfully!");
                } catch (error) {
                    console.error("Error saving user details: ", error);
                    alert("There was an error saving your details. Please try again.");
                }
            }
        },
        created() {
            firebase.auth().onAuthStateChanged(user => {
                if (user) {
                    this.currentUser = user;
                    this.fetchUserData(user);
                } else {
                    // If no user is logged in, redirect to the login page.
                    alert("You must be logged in to view this page.");
                    window.location.href = `login.html?redirect=user.html`;
                }
            });
        }
    }).mount('#user-profile-container');
}