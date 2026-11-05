import { mkdir, copyFile, cp } from 'node:fs/promises';
const pages = ['admin-management.js','site-content.js','terms.html','index.html','shop.html','about.html','contact.html','privacy.html','checkout.html','checkout-result.html','styles.css','store.js','contact.js','navigation.js','chatbot-widget.js','config.js','admin.js','checkout.js','checkout-result.js'];
await mkdir('.cf-public', { recursive: true });
for (const file of pages) await copyFile(file, `.cf-public/${file}`);
await cp('assets', '.cf-public/assets', { recursive: true });
await cp('admin', '.cf-public/admin', { recursive: true });

