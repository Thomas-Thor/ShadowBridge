// ===== SIMPLIFIED REGISTRATION MODAL =====
function openRoleModal() {
    // Uproszczony modal - bezpośrednie przekierowanie do rejestracji
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content simple-registration">
            <span class="close-modal" onclick="closeModal()">&times;</span>
            <h2>Join ShadowBridge Network</h2>
            <p class="modal-subtitle">Select your role to get started</p>
            
            <div class="role-selection-simple">
                <div class="role-card" onclick="redirectToRegistration('agent')">
                    <div class="role-icon">🎯</div>
                    <h3>Agent</h3>
                    <p>Strategic operators and network builders</p>
                    <div class="role-button">Join as Agent</div>
                </div>
                
                <div class="role-card" onclick="redirectToRegistration('client')">
                    <div class="role-icon">🏢</div>
                    <h3>Client</h3>
                    <p>Organizations seeking expansion</p>
                    <div class="role-button">Join as Client</div>
                </div>
                
                <div class="role-card" onclick="redirectToRegistration('supplier')">
                    <div class="role-icon">⚡</div>
                    <h3>Supplier</h3>
                    <p>Premium service providers</p>
                    <div class="role-button">Join as Supplier</div>
                </div>
            </div>
            
            <div class="modal-footer">
                <p class="note">Quick registration - start building your network today</p>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
    
    // Animation
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);
}

function redirectToRegistration(role) {
    // Bezpośrednie przekierowanie do odpowiedniej strony rejestracji
    const pages = {
        'agent': 'agent-registration.html',
        'client': 'client-registration.html', 
        'supplier': 'supplier-registration.html'
    };
    
    if (pages[role]) {
        window.location.href = pages[role];
    }
}

function closeModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.remove();
            document.body.style.overflow = 'auto';
        }, 300);
    }
}

// ===== SMOOTH SCROLLING =====
document.addEventListener('DOMContentLoaded', function() {
    // Smooth scrolling for anchor links
    const links = document.querySelectorAll('a[href^="#"]');
    
    links.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                const headerHeight = document.querySelector('.header').offsetHeight;
                const targetPosition = targetElement.offsetTop - headerHeight - 20;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
    
    // Mobile menu toggle
    const menuToggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.nav');
    
    if (menuToggle && nav) {
        menuToggle.addEventListener('click', function() {
            nav.classList.toggle('active');
            this.classList.toggle('active');
        });
    }
    
    // Close mobile menu when clicking on a link
    const navLinks = document.querySelectorAll('.nav a');
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            nav.classList.remove('active');
            menuToggle.classList.remove('active');
        });
    });
    
    // Header scroll effect
    let lastScrollTop = 0;
    const header = document.querySelector('.header');
    
    window.addEventListener('scroll', function() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        if (scrollTop > lastScrollTop && scrollTop > 100) {
            // Scrolling down
            header.style.transform = 'translateY(-100%)';
        } else {
            // Scrolling up
            header.style.transform = 'translateY(0)';
        }
        
        lastScrollTop = scrollTop;
    });
    
    // Check for C.A.R.T.E.L. access
    checkCartelAccess();
});

// ===== C.A.R.T.E.L. ACCESS CONTROL =====
function checkCartelAccess() {
    const urlParams = new URLSearchParams(window.location.search);
    const accessParam = urlParams.get('access');
    
    if (accessParam === 'cartel') {
        // Show C.A.R.T.E.L. Division section
        const cartelSection = document.getElementById('cartel-division');
        const cartelMenuLink = document.getElementById('cartel-menu-link');
        
        if (cartelSection) {
            cartelSection.style.display = 'block';
        }
        
        if (cartelMenuLink) {
            cartelMenuLink.style.display = 'block';
        }
        
        // Add special styling to indicate exclusive access
        document.body.classList.add('cartel-access-granted');
        
        // Optional: Add subtle notification
        console.log('🔥 C.A.R.T.E.L. Division access granted');
    }
}

// ===== VIEWPORT HEIGHT FIX FOR MOBILE =====
function setViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}

// Set on load and resize
window.addEventListener('load', setViewportHeight);
window.addEventListener('resize', setViewportHeight);
window.addEventListener('orientationchange', setViewportHeight);

