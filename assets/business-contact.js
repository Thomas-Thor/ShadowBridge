import { businessContact } from './business-contact-config.js';
const contact = document.querySelector('#whatsapp-contact');
if (contact && /^\+[1-9]\d{7,14}$/.test(businessContact.whatsappE164 || '')) {
  const destination = new URL(`https://wa.me/${businessContact.whatsappE164.slice(1)}`);
  if (businessContact.whatsappMessage) destination.searchParams.set('text', businessContact.whatsappMessage.slice(0,300));
  contact.href = destination.href;
  contact.hidden = false;
}
