// ===== SUPPLIER DASHBOARD FUNCTIONS =====

// Supplier Registration Form Handler
document.addEventListener('DOMContentLoaded', function() {
    const supplierForm = document.getElementById('supplierRegistrationForm');
    
    if (supplierForm) {
        supplierForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleSupplierRegistration();
        });
    }
    
    // Check if user is already logged in as supplier
    if (window.CartelApp && window.CartelApp.checkAuth()) {
        const user = JSON.parse(localStorage.getItem('cartelUser'));
        if (user && user.role === 'supplier') {
            showSupplierDashboard();
        }
    }
});

function handleSupplierRegistration() {
    window.CartelApp.showLoading();
    
    // Collect form data
    const formData = new FormData(document.getElementById('supplierRegistrationForm'));
    const supplierData = {};
    
    // Convert FormData to object
    for (let [key, value] of formData.entries()) {
        if (supplierData[key]) {
            // Handle multiple values (checkboxes)
            if (Array.isArray(supplierData[key])) {
                supplierData[key].push(value);
            } else {
                supplierData[key] = [supplierData[key], value];
            }
        } else {
            supplierData[key] = value;
        }
    }
    
    // Validate form
    const errors = validateSupplierForm(supplierData);
    
    if (errors.length > 0) {
        window.CartelApp.hideLoading();
        window.CartelApp.showNotification('Please correct the following errors: ' + errors.join(', '), 'error');
        return;
    }
    
    // Simulate API call
    setTimeout(() => {
        window.CartelApp.hideLoading();
        
        // Simulate successful registration
        const supplierUser = {
            id: 'supplier_' + Math.random().toString(36).substr(2, 9),
            role: 'supplier',
            email: supplierData.email,
            name: supplierData.contactName,
            company: supplierData.companyName,
            registrationDate: new Date(),
            status: 'pending_approval',
            data: supplierData
        };
        
        localStorage.setItem('cartelUser', JSON.stringify(supplierUser));
        window.CartelApp.showNotification('Registration submitted successfully! You will receive a response within 7-14 business days.', 'success');
        
        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
            showSupplierDashboard();
        }, 2000);
        
    }, 2000);
}

function validateSupplierForm(data) {
    const errors = [];
    
    if (!data.companyName || data.companyName.length < 2) {
        errors.push('Company name is required');
    }
    
    if (!data.contactName || data.contactName.length < 2) {
        errors.push('Contact name is required');
    }
    
    if (!data.email || !window.CartelApp.validateEmail(data.email)) {
        errors.push('Valid email is required');
    }
    
    if (!data.businessType) {
        errors.push('Business type is required');
    }
    
    if (!data.companySize) {
        errors.push('Company size is required');
    }
    
    if (!data.yearsInBusiness) {
        errors.push('Years in business is required');
    }
    
    if (!data.serviceDescription || data.serviceDescription.length < 50) {
        errors.push('Please provide detailed service description (minimum 50 characters)');
    }
    
    if (!data.keyClients || data.keyClients.length < 50) {
        errors.push('Please describe notable clients/projects (minimum 50 characters)');
    }
    
    if (!data.successStory || data.successStory.length < 50) {
        errors.push('Please describe your most significant success (minimum 50 characters)');
    }
    
    if (!data.valueProposition || data.valueProposition.length < 50) {
        errors.push('Please describe your unique value proposition (minimum 50 characters)');
    }
    
    if (!data.networkValue || data.networkValue.length < 50) {
        errors.push('Please describe how you can contribute to the network (minimum 50 characters)');
    }
    
    // Check required agreements
    const requiredAgreements = ['quality', 'discretion', 'availability', 'evaluation', 'terms'];
    const agreements = Array.isArray(data.agreements) ? data.agreements : [data.agreements];
    
    for (let agreement of requiredAgreements) {
        if (!agreements.includes(agreement)) {
            errors.push('All agreements must be accepted');
            break;
        }
    }
    
    return errors;
}

function showSupplierDashboard() {
    // Hide registration form
    const registrationForm = document.getElementById('registration-form');
    if (registrationForm) {
        registrationForm.classList.add('hidden');
    }
    
    // Show dashboard
    const dashboard = document.getElementById('supplier-dashboard');
    if (dashboard) {
        dashboard.classList.remove('hidden');
        loadSupplierData();
    }
}

function loadSupplierData() {
    const user = JSON.parse(localStorage.getItem('cartelUser'));
    
    if (user && user.role === 'supplier') {
        // Update supplier name
        const supplierNameElement = document.getElementById('supplier-name');
        if (supplierNameElement) {
            supplierNameElement.textContent = `Welcome, ${user.name}`;
        }
        
        // Load dashboard data
        const dashboardData = window.CartelApp.loadDashboard('supplier');
        
        // Update metrics
        updateSupplierMetrics(dashboardData);
        
        // Load services data
        loadSupplierServices(dashboardData.services);
        
        // Load orders data
        loadSupplierOrders(dashboardData.orders);
    }
}

function updateSupplierMetrics(data) {
    // Update overview cards with real data
    const activeOrdersElement = document.getElementById('active-orders');
    const monthlyRevenueElement = document.getElementById('monthly-revenue');
    const satisfactionRateElement = document.getElementById('satisfaction-rate');
    const networkRankingElement = document.getElementById('network-ranking');
    
    if (activeOrdersElement) activeOrdersElement.textContent = data.orders.length;
    if (monthlyRevenueElement) monthlyRevenueElement.textContent = '€28,500';
    if (satisfactionRateElement) satisfactionRateElement.textContent = '4.8/5';
    if (networkRankingElement) networkRankingElement.textContent = '#3';
}

function loadSupplierServices(services) {
    // This would typically load from API
    // For now, the HTML already contains sample data
    console.log('Loading supplier services:', services);
}

function loadSupplierOrders(orders) {
    // This would typically load from API
    // For now, the HTML already contains sample data
    console.log('Loading supplier orders:', orders);
}

// Service Management Functions
function addNewService() {
    window.CartelApp.showNotification('Add New Service functionality would open a modal form', 'info');
}

function editService(serviceId) {
    window.CartelApp.showNotification(`Editing service ${serviceId}`, 'info');
}

function viewServiceAnalytics(serviceId) {
    window.CartelApp.showNotification(`Viewing analytics for service ${serviceId}`, 'info');
}

function viewClientFeedback(serviceId) {
    window.CartelApp.showNotification(`Viewing client feedback for service ${serviceId}`, 'info');
}

// Order Management Functions
function updateOrder(orderId) {
    window.CartelApp.showNotification(`Updating order ${orderId}`, 'info');
}

function contactOrderClient(orderId) {
    window.CartelApp.showNotification(`Contacting client for order ${orderId}`, 'info');
}

function submitOrderDeliverable(orderId) {
    window.CartelApp.showNotification(`Submitting deliverable for order ${orderId}`, 'success');
}

function filterOrders() {
    const filter = document.getElementById('order-filter').value;
    window.CartelApp.showNotification(`Filtering orders by: ${filter}`, 'info');
}

// Performance Functions
function downloadPerformanceReport() {
    window.CartelApp.showNotification('Performance report download started', 'success');
}

function viewDetailedAnalytics() {
    window.CartelApp.showNotification('Detailed analytics view would open', 'info');
}

function exportPerformanceData() {
    window.CartelApp.showNotification('Performance data export started', 'success');
}

// Opportunity Functions
function submitProposal(opportunityId) {
    window.CartelApp.showNotification(`Submitting proposal for opportunity ${opportunityId}`, 'success');
}

function requestOpportunityDetails(opportunityId) {
    window.CartelApp.showNotification(`Requesting details for opportunity ${opportunityId}`, 'info');
}

function contactOpportunityAgent(opportunityId) {
    window.CartelApp.showNotification(`Contacting agent for opportunity ${opportunityId}`, 'info');
}

function filterOpportunities() {
    const filter = document.getElementById('opportunity-filter').value;
    window.CartelApp.showNotification(`Filtering opportunities by: ${filter}`, 'info');
}

// Profile and Settings Functions
function updateProfile() {
    window.CartelApp.showNotification('Profile update functionality would open', 'info');
}

function updateServicePricing(serviceId) {
    window.CartelApp.showNotification(`Updating pricing for service ${serviceId}`, 'info');
}

function manageAvailability() {
    window.CartelApp.showNotification('Availability management would open', 'info');
}

function viewNetworkStats() {
    window.CartelApp.showNotification('Network statistics view would open', 'info');
}

// Communication Functions
function sendMessage(recipientId) {
    window.CartelApp.showNotification(`Sending message to ${recipientId}`, 'info');
}

function scheduleCall(clientId) {
    window.CartelApp.showNotification(`Scheduling call with client ${clientId}`, 'info');
}

function joinNetworkEvent(eventId) {
    window.CartelApp.showNotification(`Joining network event ${eventId}`, 'success');
}

// Tab Management (shared with other dashboards)
function showTab(tabName) {
    // Hide all tab contents
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(tab => tab.classList.remove('active'));
    
    // Remove active class from all tab buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => button.classList.remove('active'));
    
    // Show selected tab content
    const selectedTab = document.getElementById(tabName + '-tab');
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Add active class to clicked button
    event.target.classList.add('active');
}

// Export functions for global access
window.SupplierDashboard = {
    showTab,
    handleSupplierRegistration,
    showSupplierDashboard,
    addNewService,
    editService,
    viewServiceAnalytics,
    viewClientFeedback,
    updateOrder,
    contactOrderClient,
    submitOrderDeliverable,
    filterOrders,
    downloadPerformanceReport,
    viewDetailedAnalytics,
    exportPerformanceData,
    submitProposal,
    requestOpportunityDetails,
    contactOpportunityAgent,
    filterOpportunities,
    updateProfile,
    updateServicePricing,
    manageAvailability,
    viewNetworkStats,
    sendMessage,
    scheduleCall,
    joinNetworkEvent
};

