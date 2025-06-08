// ===== CLIENT DASHBOARD FUNCTIONS =====

// Client Registration Form Handler
document.addEventListener('DOMContentLoaded', function() {
    const clientForm = document.getElementById('clientRegistrationForm');
    
    if (clientForm) {
        clientForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleClientRegistration();
        });
    }
    
    // Check if user is already logged in as client
    if (window.CartelApp && window.CartelApp.checkAuth()) {
        const user = JSON.parse(localStorage.getItem('cartelUser'));
        if (user && user.role === 'client') {
            showClientDashboard();
        }
    }
});

function handleClientRegistration() {
    window.CartelApp.showLoading();
    
    // Collect form data
    const formData = new FormData(document.getElementById('clientRegistrationForm'));
    const clientData = {};
    
    // Convert FormData to object
    for (let [key, value] of formData.entries()) {
        if (clientData[key]) {
            // Handle multiple values (checkboxes)
            if (Array.isArray(clientData[key])) {
                clientData[key].push(value);
            } else {
                clientData[key] = [clientData[key], value];
            }
        } else {
            clientData[key] = value;
        }
    }
    
    // Validate form
    const errors = validateClientForm(clientData);
    
    if (errors.length > 0) {
        window.CartelApp.hideLoading();
        window.CartelApp.showNotification('Please correct the following errors: ' + errors.join(', '), 'error');
        return;
    }
    
    // Simulate API call
    setTimeout(() => {
        window.CartelApp.hideLoading();
        
        // Simulate successful registration
        const clientUser = {
            id: 'client_' + Math.random().toString(36).substr(2, 9),
            role: 'client',
            email: clientData.email,
            name: clientData.contactName,
            company: clientData.companyName,
            registrationDate: new Date(),
            status: 'pending_approval',
            data: clientData
        };
        
        localStorage.setItem('cartelUser', JSON.stringify(clientUser));
        window.CartelApp.showNotification('Registration submitted successfully! You will receive a response within 7-14 business days.', 'success');
        
        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
            showClientDashboard();
        }, 2000);
        
    }, 2000);
}

function validateClientForm(data) {
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
    
    if (!data.industry) {
        errors.push('Industry selection is required');
    }
    
    if (!data.companySize) {
        errors.push('Company size is required');
    }
    
    if (!data.annualRevenue) {
        errors.push('Annual revenue range is required');
    }
    
    if (!data.decisionMaker) {
        errors.push('Decision making authority is required');
    }
    
    if (!data.timeline) {
        errors.push('Project timeline is required');
    }
    
    if (!data.budget) {
        errors.push('Budget range is required');
    }
    
    if (!data.challenges || data.challenges.length < 50) {
        errors.push('Please describe your challenges (minimum 50 characters)');
    }
    
    if (!data.expectations || data.expectations.length < 50) {
        errors.push('Please describe your expectations (minimum 50 characters)');
    }
    
    if (!data.successStory || data.successStory.length < 50) {
        errors.push('Please describe a success story (minimum 50 characters)');
    }
    
    // Check required agreements
    const requiredAgreements = ['discretion', 'evaluation', 'commitment', 'terms'];
    const agreements = Array.isArray(data.agreements) ? data.agreements : [data.agreements];
    
    for (let agreement of requiredAgreements) {
        if (!agreements.includes(agreement)) {
            errors.push('All agreements must be accepted');
            break;
        }
    }
    
    return errors;
}

function showClientDashboard() {
    // Hide registration form
    const registrationForm = document.getElementById('registration-form');
    if (registrationForm) {
        registrationForm.classList.add('hidden');
    }
    
    // Show dashboard
    const dashboard = document.getElementById('client-dashboard');
    if (dashboard) {
        dashboard.classList.remove('hidden');
        loadClientData();
    }
}

function loadClientData() {
    const user = JSON.parse(localStorage.getItem('cartelUser'));
    
    if (user && user.role === 'client') {
        // Update client name
        const clientNameElement = document.getElementById('client-name');
        if (clientNameElement) {
            clientNameElement.textContent = `Welcome, ${user.name}`;
        }
        
        // Load dashboard data
        const dashboardData = window.CartelApp.loadDashboard('client');
        
        // Update metrics
        updateClientMetrics(dashboardData);
        
        // Load projects data
        loadClientProjects(dashboardData.projects);
        
        // Load offers data
        loadClientOffers(dashboardData.offers);
    }
}

function updateClientMetrics(data) {
    // Update overview cards with real data
    const activeProjectsElement = document.getElementById('active-projects');
    const totalInvestmentElement = document.getElementById('total-investment');
    const roiGeneratedElement = document.getElementById('roi-generated');
    const successRateElement = document.getElementById('success-rate');
    
    if (activeProjectsElement) activeProjectsElement.textContent = data.projects.length;
    if (totalInvestmentElement) totalInvestmentElement.textContent = '€125,000';
    if (roiGeneratedElement) roiGeneratedElement.textContent = '€340,000';
    if (successRateElement) successRateElement.textContent = '85%';
}

function loadClientProjects(projects) {
    // This would typically load from API
    // For now, the HTML already contains sample data
    console.log('Loading client projects:', projects);
}

function loadClientOffers(offers) {
    // This would typically load from API
    // For now, the HTML already contains sample data
    console.log('Loading client offers:', offers);
}

// Project Management Functions
function requestNewProject() {
    window.CartelApp.showNotification('Request New Project functionality would open a modal form', 'info');
}

function viewProjectDetails(projectId) {
    window.CartelApp.showNotification(`Viewing details for project ${projectId}`, 'info');
}

function contactAgent(agentName) {
    window.CartelApp.showNotification(`Contacting agent: ${agentName}`, 'info');
}

function viewProjectReports(projectId) {
    window.CartelApp.showNotification(`Viewing reports for project ${projectId}`, 'info');
}

// Offer Management Functions
function requestOfferDetails(offerId) {
    window.CartelApp.showNotification(`Requesting details for offer ${offerId}`, 'info');
}

function contactOfferAgent(agentName) {
    window.CartelApp.showNotification(`Contacting agent: ${agentName}`, 'info');
}

function filterOffers() {
    const filter = document.getElementById('offer-filter').value;
    window.CartelApp.showNotification(`Filtering offers by: ${filter}`, 'info');
}

// Report Functions
function downloadFullReport(reportType) {
    window.CartelApp.showNotification(`Downloading ${reportType} report`, 'success');
}

function viewDetailedReport(reportType) {
    window.CartelApp.showNotification(`Viewing detailed ${reportType} report`, 'info');
}

// Support Functions
function scheduleMeeting() {
    window.CartelApp.showNotification('Meeting scheduling functionality would open calendar', 'info');
}

function requestProjectUpdate() {
    window.CartelApp.showNotification('Project update request sent', 'success');
}

function scheduleStrategyCall() {
    window.CartelApp.showNotification('Strategy call scheduling functionality would open', 'info');
}

function accessKnowledgeBase() {
    window.CartelApp.showNotification('Knowledge base would open in new window', 'info');
}

function submitFeedback() {
    window.CartelApp.showNotification('Feedback form would open', 'info');
}

function accessResource(resourceName) {
    window.CartelApp.showNotification(`Accessing resource: ${resourceName}`, 'info');
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
window.ClientDashboard = {
    showTab,
    handleClientRegistration,
    showClientDashboard,
    requestNewProject,
    viewProjectDetails,
    contactAgent,
    viewProjectReports,
    requestOfferDetails,
    contactOfferAgent,
    filterOffers,
    downloadFullReport,
    viewDetailedReport,
    scheduleMeeting,
    requestProjectUpdate,
    scheduleStrategyCall,
    accessKnowledgeBase,
    submitFeedback,
    accessResource
};

