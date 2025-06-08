// ===== GLOBAL VARIABLES =====
let currentUser = null;
let currentRole = null;

// ===== NAVIGATION FUNCTIONS =====
function toggleMenu() {
    const nav = document.querySelector('.nav ul');
    nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
}

// ===== MODAL FUNCTIONS =====
function showRegistration() {
    document.getElementById('registration-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function hideRegistration() {
    document.getElementById('registration-modal').style.display = 'none';
    document.body.style.overflow = 'auto';
}

// ===== ROLE SELECTION =====
function selectRole(role) {
    currentRole = role;
    hideRegistration();
    
    // Redirect to appropriate registration form
    switch(role) {
        case 'agent':
            window.location.href = 'agent-registration.html';
            break;
        case 'client':
            window.location.href = 'client-registration.html';
            break;
        case 'supplier':
            window.location.href = 'supplier-registration.html';
            break;
    }
}

// ===== SMOOTH SCROLLING =====
document.addEventListener('DOMContentLoaded', function() {
    // Smooth scrolling for navigation links
    const navLinks = document.querySelectorAll('a[href^="#"]');
    
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetSection = document.querySelector(targetId);
            
            if (targetSection) {
                targetSection.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', function(e) {
        const modal = document.getElementById('registration-modal');
        if (e.target === modal) {
            hideRegistration();
        }
    });
    
    // Escape key to close modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            hideRegistration();
        }
    });
});

// ===== SCROLL ANIMATIONS =====
function observeElements() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });
    
    // Observe all sections
    const sections = document.querySelectorAll('section');
    sections.forEach(section => {
        section.style.opacity = '0';
        section.style.transform = 'translateY(30px)';
        section.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(section);
    });
}

// ===== USER AUTHENTICATION SIMULATION =====
function simulateLogin(email, password, role) {
    // Simulate API call
    return new Promise((resolve) => {
        setTimeout(() => {
            currentUser = {
                email: email,
                role: role,
                id: Math.random().toString(36).substr(2, 9),
                loginTime: new Date()
            };
            
            // Store in localStorage for persistence
            localStorage.setItem('cartelUser', JSON.stringify(currentUser));
            
            resolve(currentUser);
        }, 1000);
    });
}

function logout() {
    currentUser = null;
    localStorage.removeItem('cartelUser');
    window.location.href = 'index.html';
}

function checkAuth() {
    const stored = localStorage.getItem('cartelUser');
    if (stored) {
        currentUser = JSON.parse(stored);
        return true;
    }
    return false;
}

// ===== FORM VALIDATION =====
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validatePhone(phone) {
    const re = /^[\+]?[1-9][\d]{0,15}$/;
    return re.test(phone.replace(/\s/g, ''));
}

function validateForm(formData) {
    const errors = [];
    
    if (!formData.name || formData.name.length < 2) {
        errors.push('Name must be at least 2 characters long');
    }
    
    if (!validateEmail(formData.email)) {
        errors.push('Please enter a valid email address');
    }
    
    if (formData.phone && !validatePhone(formData.phone)) {
        errors.push('Please enter a valid phone number');
    }
    
    return errors;
}

// ===== DASHBOARD FUNCTIONS =====
function loadDashboard(role) {
    switch(role) {
        case 'agent':
            loadAgentDashboard();
            break;
        case 'client':
            loadClientDashboard();
            break;
        case 'supplier':
            loadSupplierDashboard();
            break;
    }
}

function loadAgentDashboard() {
    // Simulate loading agent data
    const agentData = {
        clients: [
            { id: 1, name: 'TechCorp Ltd', status: 'Active', value: '€75,000' },
            { id: 2, name: 'Global Trading', status: 'Negotiation', value: '€120,000' }
        ],
        offers: [
            { id: 1, client: 'TechCorp Ltd', value: '€85,000', status: 'Pending Approval' },
            { id: 2, client: 'ABC Corp', value: '€150,000', status: 'With Client' }
        ],
        performance: {
            thisMonth: { deals: 3, value: '€180,000', commission: '€19,500' },
            pipeline: { offers: 8, value: '€650,000', commission: '€71,500' }
        }
    };
    
    return agentData;
}

function loadClientDashboard() {
    // Simulate loading client data
    const clientData = {
        projects: [
            { id: 1, name: 'Market Expansion', status: 'In Progress', agent: 'John Smith' },
            { id: 2, name: 'Supply Chain Optimization', status: 'Planning', agent: 'Anna Johnson' }
        ],
        offers: [
            { id: 1, service: 'Strategic Consulting', value: '€50,000', status: 'Under Review' },
            { id: 2, service: 'Market Research', value: '€25,000', status: 'Accepted' }
        ]
    };
    
    return clientData;
}

function loadSupplierDashboard() {
    // Simulate loading supplier data
    const supplierData = {
        services: [
            { id: 1, name: 'Legal Advisory', category: 'Professional Services', price: '€500/hour' },
            { id: 2, name: 'Market Research', category: 'Analytics', price: '€5,000/project' }
        ],
        orders: [
            { id: 1, client: 'TechCorp Ltd', service: 'Legal Advisory', status: 'In Progress' },
            { id: 2, client: 'Global Trading', service: 'Market Research', status: 'Completed' }
        ]
    };
    
    return supplierData;
}

// ===== UTILITY FUNCTIONS =====
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-EU', {
        style: 'currency',
        currency: 'EUR'
    }).format(amount);
}

function formatDate(date) {
    return new Intl.DateTimeFormat('en-EU', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    }).format(new Date(date));
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        color: white;
        border-radius: 5px;
        z-index: 3000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// ===== LOADING FUNCTIONS =====
function showLoading() {
    const loader = document.createElement('div');
    loader.id = 'loader';
    loader.innerHTML = `
        <div style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 4000;
        ">
            <div style="
                width: 50px;
                height: 50px;
                border: 3px solid #d4af37;
                border-top: 3px solid transparent;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
        </div>
    `;
    
    document.body.appendChild(loader);
}

function hideLoading() {
    const loader = document.getElementById('loader');
    if (loader) {
        document.body.removeChild(loader);
    }
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', function() {
    // Initialize scroll animations
    observeElements();
    
    // Check if user is already logged in
    if (checkAuth()) {
        // User is logged in, could redirect to dashboard
        console.log('User logged in:', currentUser);
    }
    
    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});

// ===== EXPORT FOR OTHER PAGES =====
window.CartelApp = {
    showRegistration,
    hideRegistration,
    selectRole,
    simulateLogin,
    logout,
    checkAuth,
    validateForm,
    loadDashboard,
    showNotification,
    showLoading,
    hideLoading,
    formatCurrency,
    formatDate
};

