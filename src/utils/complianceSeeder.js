const ChecklistTemplate = require("../models/ChecklistTemplate");

async function initializeComplianceTemplates() {
  try {
    const templatesCount = await ChecklistTemplate.countDocuments();
    if (templatesCount > 0) {
      console.log("[Compliance Seeder] Templates already exist, skipping seeding.");
      return;
    }

    const defaultTemplates = [
      {
        name: "Marketing Website Template",
        key: "marketing",
        categories: [
          {
            name: "Domain & DNS",
            items: [
              { title: "Point Domain DNS", description: "Point A/CNAME records to the production hosting provider.", requiresEvidence: true },
              { title: "SSL / HTTPS Certificate", description: "Verify active HTTPS/SSL certificate for the main domain and subdomains.", requiresEvidence: true }
            ]
          },
          {
            name: "Security",
            items: [
              { title: "HTTPS Redirect", description: "Ensure HTTP calls redirect automatically to secure HTTPS.", requiresEvidence: false },
              { title: "Spam Protection on Contact Forms", description: "Configure reCAPTCHA, Cloudflare Turnstile, or honeypots to block spam entries.", requiresEvidence: false }
            ]
          },
          {
            name: "Analytics & SEO",
            items: [
              { title: "Google Analytics Tracking", description: "Install Google Analytics / GA4 tracking tags.", requiresEvidence: true },
              { title: "SEO Meta Tag Audit", description: "Audit titles, descriptions, and keywords across all pages.", requiresEvidence: false },
              { title: "XML Sitemap & Robots.txt", description: "Verify generation of sitemap.xml and configuration of robots.txt.", requiresEvidence: false }
            ]
          },
          {
            name: "Marketing & Social",
            items: [
              { title: "OpenGraph / Social Previews", description: "Configure OpenGraph image tags for rich sharing cards on Twitter, LinkedIn, and Facebook.", requiresEvidence: true },
              { title: "Email Newsletter Sync", description: "Connect lead capture forms to Mailchimp, HubSpot, or equivalent email marketing CRM.", requiresEvidence: false }
            ]
          },
          {
            name: "QA Testing",
            items: [
              { title: "Contact Form QA", description: "Submit test inquiries on all forms and verify delivery to notification emails.", requiresEvidence: true },
              { title: "Mobile Responsiveness Review", description: "Audit design across iOS, Android, and tablet viewports.", requiresEvidence: false },
              { title: "Page Speed Audit", description: "Run Lighthouse test and ensure performance score is above 80.", requiresEvidence: true }
            ]
          },
          {
            name: "Compliance & Integrations",
            items: [
              { title: "Privacy Policy & Terms Links", description: "Add required legal footer links to the layout.", requiresEvidence: false },
              { title: "Cookie Consent Banner", description: "Render standard GDPR/CCPA cookie notification banner.", requiresEvidence: false },
              { title: "Stripe Integration", description: "Verify active Stripe payment gateway and webhook handlers.", requiresEvidence: true },
              { title: "Bug Report Button", description: "Verify functional Bug Report button on the website interface.", requiresEvidence: false },
              { title: "Google Maps", description: "Verify Google Maps location embed or API integration.", requiresEvidence: false },
              { title: "Apple Maps", description: "Verify Apple Maps link or MapKit integration.", requiresEvidence: false },
              { title: "info@ Email Setup", description: "Verify active info@<domain> email account and forwarding for every active website.", requiresEvidence: true },
              { title: "nathan@ Email Setup", description: "Verify active nathan@<domain> email account and forwarding for every active website.", requiresEvidence: true }
            ]
          },
          {
            name: "Launch Approval",
            items: [
              { title: "Executive Stakeholder Sign-Off", description: "Obtain formal launch approval from marketing lead or business unit owner.", requiresEvidence: true }
            ]
          }
        ]
      },
      {
        name: "SaaS Platform Template",
        key: "saas",
        categories: [
          {
            name: "Domain & DNS",
            items: [
              { title: "Point Domain DNS", description: "Setup DNS routing for app.domain.com and handle dynamic subdomains if applicable.", requiresEvidence: true },
              { title: "SSL / HTTPS Certificate", description: "Verify active HTTPS and configure automated SSL renewal.", requiresEvidence: true }
            ]
          },
          {
            name: "Security",
            items: [
              { title: "CSRF & XSS Protection", description: "Verify security headers, cookie flags (Secure, SameSite), and sanitization.", requiresEvidence: false },
              { title: "OAuth / Single Sign-On Integration", description: "Verify Google/GitHub/SSO authentication flow and session limits.", requiresEvidence: true },
              { title: "Database Firewall lockdown", description: "Lock down MongoDB/PostgreSQL ports to accept connections only from web server IP.", requiresEvidence: false }
            ]
          },
          {
            name: "Hosting & DB",
            items: [
              { title: "Automated Database Backups", description: "Verify hourly/daily backups with automated retention limits.", requiresEvidence: true },
              { title: "Redis Cache Configuration", description: "Verify production cache thresholds and eviction policies.", requiresEvidence: false }
            ]
          },
          {
            name: "Analytics & Monitoring",
            items: [
              { title: "Analytics Tracking Setup", description: "Verify Amplitude, Mixpanel, or Google Analytics event logging.", requiresEvidence: false },
              { title: "Sentry Error Tracking Integration", description: "Verify live crash report collection on client and backend.", requiresEvidence: true },
              { title: "Uptime & SLA Monitoring", description: "Verify ping rules on UptimeRobot or BetterStack.", requiresEvidence: true }
            ]
          },
          {
            name: "Billing & Legal",
            items: [
              { title: "Stripe/Payment Gateway QA", description: "Verify payment processing, coupon systems, and subscription webhook handlers in production.", requiresEvidence: true },
              { title: "Terms of Service Agreement Check", description: "Verify user agreement checkmark on signup page.", requiresEvidence: false }
            ]
          },
          {
            name: "QA Testing",
            items: [
              { title: "Full User Funnel Flow QA", description: "Test signup -> billing -> dashboard -> logout funnel.", requiresEvidence: true },
              { title: "Load & Stress Testing validation", description: "Simulate concurrent hits to ensure scaling triggers.", requiresEvidence: true },
              { title: "Verify Backup Restoration", description: "Restore a database backup on testing environment to ensure validity.", requiresEvidence: true }
            ]
          },
          {
            name: "Compliance",
            items: [
              { title: "GDPR Data Export Tool", description: "Provide direct method for users to request data downloads/account deletion.", requiresEvidence: false }
            ]
          },
          {
            name: "Launch Approval",
            items: [
              { title: "Dev Lead Production Sign-Off", description: "Verify code freeze and production environment readiness.", requiresEvidence: true },
              { title: "Compliance & Security Review", description: "Obtain security approval.", requiresEvidence: true }
            ]
          }
        ]
      },
      {
        name: "E-Commerce Website Template",
        key: "ecommerce",
        categories: [
          {
            name: "Domain & DNS",
            items: [
              { title: "Point Domain DNS", description: "Setup main domain and connect CDN caching layers (Cloudflare).", requiresEvidence: true },
              { title: "SSL Certification", description: "Ensure encrypted data transmission for compliance.", requiresEvidence: true }
            ]
          },
          {
            name: "Security",
            items: [
              { title: "PCI-DSS Security Audit", description: "Complete PCI self-assessment to verify payment handling safety.", requiresEvidence: true }
            ]
          },
          {
            name: "QA Testing",
            items: [
              { title: "Payment Checkout Funnel Test", description: "Run test purchases with real cards and check webhook responses.", requiresEvidence: true },
              { title: "Inventory Sync QA", description: "Verify product count updates automatically on purchase.", requiresEvidence: false },
              { title: "Tax Rate & Shipping Calculator Test", description: "Validate correct tax calculations and shipping tier pricing.", requiresEvidence: true },
              { title: "Transactional Email Formats", description: "Verify order confirmation, invoice, and shipping notification designs.", requiresEvidence: false }
            ]
          },
          {
            name: "Analytics & Marketing",
            items: [
              { title: "Conversion Tracking Setup", description: "Install Meta Pixel, TikTok Pixel, or GA4 e-commerce purchase tags.", requiresEvidence: true },
              { title: "Abandoned Cart Flow QA", description: "Verify reminder emails trigger 1 hour post cart abandonment.", requiresEvidence: false }
            ]
          },
          {
            name: "Compliance",
            items: [
              { title: "Return & Refund Policy Links", description: "Verify clear terms of sale and refund visibility at footer/checkout.", requiresEvidence: false }
            ]
          },
          {
            name: "Launch Approval",
            items: [
              { title: "Operations & Inventory Lead Approval", description: "Confirm warehouses are synced and logistics partners are active.", requiresEvidence: true }
            ]
          }
        ]
      },
      {
        name: "Internal Application Template",
        key: "internal",
        categories: [
          {
            name: "Domain & DNS",
            items: [
              { title: "Internal Domain Routing", description: "Configure secure internal subdomains.", requiresEvidence: false }
            ]
          },
          {
            name: "Security",
            items: [
              { title: "SSO / Active Directory Login", description: "Verify single sign-on via employee corporate portal.", requiresEvidence: true },
              { title: "VPN / IP Range Restriction", description: "Limit connection access to company office IP addresses or secure VPN.", requiresEvidence: true },
              { title: "Database Encryption at Rest", description: "Enable full database encryption.", requiresEvidence: false }
            ]
          },
          {
            name: "QA Testing",
            items: [
              { title: "Access Role Matrix Review", description: "Verify read/write restrictions across different employee tiers.", requiresEvidence: true },
              { title: "User Acceptance Testing (UAT)", description: "Collect UAT approval certificates from primary internal department.", requiresEvidence: true }
            ]
          },
          {
            name: "Launch Approval",
            items: [
              { title: "IT/Security Lead Final Sign-Off", description: "Verify data privacy and access credentials are secure.", requiresEvidence: true }
            ]
          }
        ]
      }
    ];

    await ChecklistTemplate.insertMany(defaultTemplates);
    console.log("[Compliance Seeder] Successfully seeded default compliance templates.");
  } catch (err) {
    console.error("[Compliance Seeder] Seeding error:", err);
  }
}

module.exports = { initializeComplianceTemplates };
