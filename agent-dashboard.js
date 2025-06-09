// ===== AGENT DASHBOARD FUNCTIONS =====

// Tab Management
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

// Agent Registration Form Handler
document.addEventListener('DOMContentLoaded', function() {
    const agentForm = document.getElementById('agentRegistrationForm');
    
    if (agentForm) {
        agentForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleAgentRegistration();
        });
    }
    
    // Check if user is already logged in as agent
    if (window.cartelAPI && window.cartelAPI.checkAuth()) {
        const user = window.cartelAPI.getCurrentUser();
        if (user && user.role === 'agent') {
            showAgentDashboard();
        }
    }
});

async function handleAgentRegistration() {
    try {
        const formData = new FormData(document.getElementById('agentRegistrationForm'));
        const result = await window.CartelApp.handleRegistration(formData, 'agent');
        
        // Show dashboard after successful registration
        setTimeout(() => {
            showAgentDashboard();
        }, 2000);
        
    } catch (error) {
        console.error('Agent registration failed:', error);
    }
}

function showAgentDashboard() {
    // Hide registration form
    const registrationForm = document.getElementById('registration-form');
    if (registrationForm) {
        registrationForm.classList.add('hidden');
    }
    
    // Show dashboard
    const dashboard = document.getElementById('agent-dashboard');
    if (dashboard) {
        dashboard.classList.remove('hidden');
        loadAgentData();
    }
}

async function loadAgentData() {
    const user = window.cartelAPI ? window.cartelAPI.getCurrentUser() : null;
    
    if (user && user.role === 'agent') {
        // Update agent name
        const agentNameElement = document.getElementById('agent-name');
        if (agentNameElement) {
            agentNameElement.textContent = `Welcome, ${user.first_name} ${user.last_name}`;
        }
        
        // Load dashboard data from API
        try {
            const dashboardData = await window.CartelApp.loadDashboard('agent');
            if (dashboardData) {
                updateAgentMetrics(dashboardData);
                loadAgentClients(dashboardData.clients);
                loadAgentOffers(dashboardData.offers);
            }
        } catch (error) {
            console.error('Failed to load agent dashboard data:', error);
        }
    }
}

function updateAgentMetrics(data) {
    // Update overview cards with real data
    const activeClientsElement = document.getElementById('active-clients');
    const pipelineValueElement = document.getElementById('pipeline-value');
    const monthCommissionElement = document.getElementById('month-commission');
    const successRateElement = document.getElementById('success-rate');
    
    if (data.overview) {
        if (activeClientsElement) activeClientsElement.textContent = data.overview.active_clients;
        if (pipelineValueElement) pipelineValueElement.textContent = data.overview.pipeline_value;
        if (monthCommissionElement) monthCommissionElement.textContent = data.overview.month_commission;
        if (successRateElement) successRateElement.textContent = data.overview.success_rate;
    }
}

function loadAgentClients(clients) {
    console.log('Loading agent clients:', clients);
    // This would update the clients table/grid with real data
}

function loadAgentOffers(offers) {
    console.log('Loading agent offers:', offers);
    // This would update the offers table/grid with real data
}

// Client Management Functions
function addNewClient() {
    window.CartelApp.showNotification('Add New Client functionality would open a modal form', 'info');
}

function contactClient(clientId) {
    window.CartelApp.showNotification(`Contacting client ${clientId}`, 'info');
}

function viewClientNotes(clientId) {
    window.CartelApp.showNotification(`Viewing notes for client ${clientId}`, 'info');
}

function viewClientHistory(clientId) {
    window.CartelApp.showNotification(`Viewing history for client ${clientId}`, 'info');
}

// Offer Management Functions
function createNewOffer() {
    window.CartelApp.showNotification('Create New Offer functionality would open a modal form', 'info');
}

function editOffer(offerId) {
    window.CartelApp.showNotification(`Editing offer ${offerId}`, 'info');
}

function cancelOffer(offerId) {
    if (confirm('Are you sure you want to cancel this offer?')) {
        window.CartelApp.showNotification(`Offer ${offerId} cancelled`, 'success');
    }
}

function trackOffer(offerId) {
    window.CartelApp.showNotification(`Tracking offer ${offerId}`, 'info');
}

// Performance Functions
function downloadPerformanceReport() {
    window.CartelApp.showNotification('Performance report download started', 'success');
}

function viewDetailedAnalytics() {
    window.CartelApp.showNotification('Detailed analytics view would open', 'info');
}

// Resource Functions
function accessTrainingMaterial(materialId) {
    window.CartelApp.showNotification(`Accessing training material: ${materialId}`, 'info');
}

function downloadTemplate(templateId) {
    window.CartelApp.showNotification(`Downloading template: ${templateId}`, 'success');
}

// Export functions for global access
window.AgentDashboard = {
    showTab,
    handleAgentRegistration,
    showAgentDashboard,
    addNewClient,
    contactClient,
    viewClientNotes,
    viewClientHistory,
    createNewOffer,
    editOffer,
    cancelOffer,
    trackOffer,
    downloadPerformanceReport,
    viewDetailedAnalytics,
    accessTrainingMaterial,
    downloadTemplate
};


// ===== C.A.R.T.E.L. DIVISION APPLICATION FUNCTIONS =====

function openCartelApplication() {
    const modal = document.getElementById('cartel-application-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        
        // Pre-fill user data if available
        const user = window.cartelAPI ? window.cartelAPI.getCurrentUser() : null;
        if (user) {
            document.getElementById('cartel-first-name').value = user.first_name || '';
            document.getElementById('cartel-last-name').value = user.last_name || '';
        }
    }
}

function closeCartelApplication() {
    const modal = document.getElementById('cartel-application-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        
        // Reset form
        document.getElementById('cartelApplicationForm').reset();
    }
}

async function submitCartelApplication(event) {
    event.preventDefault();
    
    try {
        window.CartelApp.showLoading();
        
        const formData = new FormData(event.target);
        const applicationData = {};
        
        // Convert FormData to object
        for (let [key, value] of formData.entries()) {
            if (applicationData[key]) {
                // Handle multiple values (checkboxes)
                if (Array.isArray(applicationData[key])) {
                    applicationData[key].push(value);
                } else {
                    applicationData[key] = [applicationData[key], value];
                }
            } else {
                applicationData[key] = value;
            }
        }
        
        // Validate required fields
        const requiredFields = ['firstName', 'lastName', 'currentLevel', 'achievements', 'strategicVision'];
        const missingFields = requiredFields.filter(field => !applicationData[field]);
        
        if (missingFields.length > 0) {
            throw new Error(`Please fill in all required fields: ${missingFields.join(', ')}`);
        }
        
        // Check commitments
        const commitments = Array.isArray(applicationData.commitments) ? applicationData.commitments : [applicationData.commitments];
        if (!commitments || commitments.length < 4) {
            throw new Error('Please accept all commitment requirements');
        }
        
        // Simulate API call to submit C.A.R.T.E.L. application
        // In real implementation, this would call the backend API
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        window.CartelApp.hideLoading();
        window.CartelApp.showNotification('C.A.R.T.E.L. Division application submitted successfully! You will receive a response within 7-14 business days.', 'success');
        
        closeCartelApplication();
        
        // Log application data for development
        console.log('C.A.R.T.E.L. Application Data:', applicationData);
        
    } catch (error) {
        window.CartelApp.hideLoading();
        window.CartelApp.showNotification(error.message || 'Failed to submit application', 'error');
    }
}

// Add to existing AgentDashboard exports
if (window.AgentDashboard) {
    window.AgentDashboard.openCartelApplication = openCartelApplication;
    window.AgentDashboard.closeCartelApplication = closeCartelApplication;
    window.AgentDashboard.submitCartelApplication = submitCartelApplication;
} else {
    window.AgentDashboard = {
        openCartelApplication,
        closeCartelApplication,
        submitCartelApplication
    };
}

