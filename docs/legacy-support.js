/* Static compatibility helpers. These helpers do not authenticate or submit data. */
(function () {
    'use strict';
    const source = document.currentScript.src;
    const repositoryRoot = new URL('../', source);
    const unavailable = 'Registration is unavailable: the authentication and database backend is not connected. Nothing has been submitted or saved.';
    let previousFocus;

    function setMenu(open) {
        const nav = document.querySelector('.header .nav');
        const toggle = document.querySelector('.menu-toggle');
        if (!nav || !toggle) return;
        nav.classList.toggle('active', open);
        toggle.classList.toggle('active', open);
        toggle.setAttribute('aria-expanded', String(open));
    }

    function notify(message) {
        let status = document.getElementById('legacy-status');
        const target = document.querySelector('.dashboard-main:not(.hidden)') || document.querySelector('.registration-content, .form-container, main');
        if (!status) {
            status = document.createElement('p');
            status.id = 'legacy-status';
            status.className = 'legacy-notice';
            status.setAttribute('role', 'status');
            if (target) target.prepend(status);
            else document.body.appendChild(status);
        }
        if (target && status.parentElement !== target) target.prepend(status);
        status.textContent = message || unavailable;
        return { success: false, unavailable: true };
    }

    function roleURL(role) {
        const pages = { agent: 'agent-registration.html', client: 'clients/client-registration.html', supplier: 'suppliers/supplier-registration.html' };
        return pages[role] ? new URL(pages[role], repositoryRoot) : null;
    }

    async function navigateRole(role) {
        const destination = roleURL(role);
        if (!destination) return;
        // A docs-only publication cannot include sibling folders outside its root.
        // Check only the local, same-origin destination, never an external API.
        try {
            const response = await fetch(destination, { method: 'HEAD' });
            if (!response.ok) throw new Error('Legacy form not included in this publication');
            window.location.assign(destination.href);
        } catch (_) {
            notify('This static publication does not include the selected legacy form. Registration remains unavailable until a verified backend is connected.');
            window.alert('The selected legacy form is not included in this static publication. Registration is unavailable.');
        }
    }

    function openModal(modal) {
        if (!modal) return;
        previousFocus = document.activeElement;
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Legacy role forms — registration unavailable');
        const focusable = modal.querySelector('button, [tabindex="0"]');
        if (focusable) focusable.focus();
    }

    function closeModal(modal) {
        if (!modal) return;
        modal.style.display = 'none';
        document.body.style.overflow = '';
        if (previousFocus) previousFocus.focus();
    }

    window.ShadowBridgeLegacy = { notify, unavailable, roleURL, navigateRole, openModal, closeModal, setMenu, repositoryRoot };

    document.addEventListener('DOMContentLoaded', function () {
        const toggle = document.querySelector('.menu-toggle');
        const list = document.querySelector('.header .nav ul');
        if (toggle && list) {
            list.id = 'legacy-navigation';
            toggle.setAttribute('aria-controls', list.id);
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', 'Toggle navigation');
            document.querySelectorAll('.header .nav a').forEach(link => link.addEventListener('click', () => setMenu(false)));
        }
        document.querySelectorAll('.role-option').forEach(option => {
            option.setAttribute('role', 'button');
            option.tabIndex = 0;
            option.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    option.click();
                }
            });
        });
        document.querySelectorAll('a[href="#"]').forEach(link => {
            link.addEventListener('click', event => {
                event.preventDefault();
                if (!link.hasAttribute('onclick')) notify('This legacy resource is not available in the static preview. No action has been performed.');
            });
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') setMenu(false);
            const modal = document.querySelector('.modal[style*="display: block"], .modal-overlay.active');
            if (event.key !== 'Tab' || !modal) return;
            const items = Array.from(modal.querySelectorAll('button, a[href], [tabindex="0"], input, select, textarea')).filter(item => !item.disabled && item.offsetParent !== null);
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        const form = document.querySelector('#agentRegistrationForm, #clientRegistrationForm, #supplierRegistrationForm, #quickRegistrationForm');
        if (form) {
            notify(unavailable);
            const submit = form.querySelector('[type="submit"]');
            if (submit) {
                submit.textContent = 'Check form locally — registration unavailable';
                submit.disabled = false;
            }
        }
    });
}());
