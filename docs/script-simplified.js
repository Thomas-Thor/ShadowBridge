// ===== SIMPLIFIED REGISTRATION MODAL =====
function openRoleModal() {
    if (document.querySelector('.modal-overlay')) return;
    // Retained legacy role selector; forms are unavailable for actual registration.
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content simple-registration">
            <button type="button" class="close-modal" aria-label="Close role selection" onclick="closeModal()">&times;</button>
            <h2>Join ShadowBridge Network</h2>
            <p class="modal-subtitle">Inspect the original role forms. Registration is unavailable; no account will be created.</p>
            
            <div class="role-selection-simple">
                <div class="role-card" role="button" tabindex="0" onclick="redirectToRegistration('agent')">
                    <div class="role-icon">🎯</div>
                    <h3>Agent</h3>
                    <p>Strategic operators and network builders</p>
                    <div class="role-button">Join as Agent</div>
                </div>
                
                <div class="role-card" role="button" tabindex="0" onclick="redirectToRegistration('client')">
                    <div class="role-icon">🏢</div>
                    <h3>Client</h3>
                    <p>Organizations seeking expansion</p>
                    <div class="role-button">Join as Client</div>
                </div>
                
                <div class="role-card" role="button" tabindex="0" onclick="redirectToRegistration('supplier')">
                    <div class="role-icon">⚡</div>
                    <h3>Supplier</h3>
                    <p>Premium service providers</p>
                    <div class="role-button">Join as Supplier</div>
                </div>
            </div>
            
            <div class="modal-footer">
                <p class="note">Static preview only — authentication and database backend not connected.</p>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    window.ShadowBridgeLegacy.openModal(modal);
    modal.querySelectorAll('.role-card').forEach(card => card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); }
    }));
    
    // Animation
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);
}

function redirectToRegistration(role) {
    return window.ShadowBridgeLegacy.navigateRole(role);
    // Superseded historical route table retained below for review.
    // Bezpośrednie przekierowanie do odpowiedniej strony rejestracji
    const pages = {
        'agent': '../agent-registration.html',
        'client': '../clients/client-registration.html',
        'supplier': '../suppliers/supplier-registration.html'
    };
    
    if (pages[role]) {
        window.location.href = pages[role];
    }
}

function closeModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
        modal.classList.remove('active');
        window.ShadowBridgeLegacy.closeModal(modal);
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
            if (!targetId || targetId === '#') return;
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
    
    if (menuToggle && nav && !menuToggle.hasAttribute('onclick')) {
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
        console.info('Legacy section preview only; URL parameters do not grant authorization.');
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



// Compatibility aliases used by existing inline buttons.
function showRegistration() { openRoleModal(); }
function hideRegistration() { closeModal(); }
function selectRole(role) { return redirectToRegistration(role); }
function toggleMenu() {
    const nav = document.querySelector('.header .nav');
    if (nav) window.ShadowBridgeLegacy.setMenu(!nav.classList.contains('active'));
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
document.addEventListener('click', event => { if (event.target.matches('.modal-overlay')) closeModal(); });
