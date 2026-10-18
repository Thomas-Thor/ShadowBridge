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
    const button = Array.from(tabButtons).find(item => item.getAttribute('onclick') === "showTab('" + tabName + "')");
    if (button) button.classList.add('active');
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
    return window.CartelApp.handleRegistration();
    // Historical registration flow below remains disabled until real backend integration.
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
    if (!window.CartelApp.isDashboardPreview()) return window.CartelApp.handleRegistration();
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
    const user = window.CartelApp.getPreviewUser('agent');
    
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
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
}

function contactClient(clientId) {
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
}

function viewClientNotes(clientId) {
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
}

function viewClientHistory(clientId) {
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
}

// Offer Management Functions
function createNewOffer() {
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
}

function editOffer(offerId) {
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
}

function cancelOffer(offerId) {
    if (confirm('Are you sure you want to cancel this offer?')) {
        window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
    }
}

function trackOffer(offerId) {
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
}

// Performance Functions
function downloadPerformanceReport() {
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
}

function viewDetailedAnalytics() {
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
}

// Resource Functions
function accessTrainingMaterial(materialId) {
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
}

function downloadTemplate(templateId) {
    window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
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
        const user = window.CartelApp.getPreviewUser('agent');
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
    return window.CartelApp.handleRegistration();
    // Historical application simulation below is retained but cannot submit or log personal data.
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
        window.CartelApp.showNotification('Preview only: this action is unavailable. Nothing has been submitted, changed or downloaded.', 'info');
        
        closeCartelApplication();
        
        // Log application data for development
        // Removed from execution to protect personal data: console.log('C.A.R.T.E.L. Application Data:', applicationData);
        
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

