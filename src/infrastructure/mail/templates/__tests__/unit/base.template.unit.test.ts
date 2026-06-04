import { describe, expect, it } from 'vitest';
import { baseTemplate } from '@/infrastructure/mail/templates/base.template.js';

describe('baseTemplate HTML escaping', () => {
  it('escapes a script-tag injection in the title', () => {
    const html = baseTemplate({
      title: '<script>alert(1)</script>',
      body: '<p>Hello</p>',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes markup and quotes in the preheader', () => {
    const html = baseTemplate({
      title: 'Hi',
      preheader: '"><img src=x onerror=alert(1)>',
      body: '<p>Hello</p>',
    });

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes markup in the footerText', () => {
    const html = baseTemplate({
      title: 'Hi',
      body: '<p>Hello</p>',
      footerText: '<a href="javascript:alert(1)">x</a>',
    });

    expect(html).not.toContain('<a href="javascript:alert(1)">');
    expect(html).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;');
  });

  it('keeps the default footer text when none is supplied', () => {
    const html = baseTemplate({
      title: 'Hi',
      body: '<p>Hello</p>',
    });

    expect(html).toContain('This is an automated message. Please do not reply.');
  });

  it('treats the body parameter as trusted HTML and does not escape it', () => {
    const html = baseTemplate({
      title: 'Hi',
      body: '<h1>Heading</h1><p><strong>bold</strong></p>',
    });

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('omits the preheader span when preheader is not provided', () => {
    const html = baseTemplate({
      title: 'Hi',
      body: '<p>Hello</p>',
    });

    expect(html).not.toContain('class="preheader"');
  });

  it('renders plain text in title/preheader/footerText without altering safe characters', () => {
    const html = baseTemplate({
      title: 'Welcome to Acme',
      preheader: 'Your account is ready',
      body: '<p>Hello</p>',
      footerText: 'Sent by Acme Inc.',
    });

    expect(html).toContain('<title>Welcome to Acme</title>');
    expect(html).toContain('Your account is ready');
    expect(html).toContain('Sent by Acme Inc.');
  });
});
