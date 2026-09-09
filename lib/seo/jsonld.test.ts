import { describe, it, expect } from 'vitest';
import { buildBreadcrumbList, jsonLdScriptProps } from './jsonld';

describe('buildBreadcrumbList', () => {
  it('numbers positions from 1 in the given order', () => {
    const list = buildBreadcrumbList([
      { name: 'Home', url: 'https://example.com' },
      { name: 'Docs', url: 'https://example.com/docs' },
      { name: 'API Reference', url: 'https://example.com/docs/api' },
    ]);

    expect(list['@context']).toBe('https://schema.org');
    expect(list['@type']).toBe('BreadcrumbList');
    expect(list.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com' },
      { '@type': 'ListItem', position: 2, name: 'Docs', item: 'https://example.com/docs' },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'API Reference',
        item: 'https://example.com/docs/api',
      },
    ]);
  });

  it('handles a single-item trail', () => {
    const list = buildBreadcrumbList([{ name: 'Home', url: 'https://example.com' }]);
    expect(list.itemListElement).toHaveLength(1);
    expect(list.itemListElement[0]?.position).toBe(1);
  });

  it('handles an empty trail', () => {
    expect(buildBreadcrumbList([]).itemListElement).toEqual([]);
  });
});

describe('jsonLdScriptProps', () => {
  it('serializes the data as the script body', () => {
    const props = jsonLdScriptProps({ a: 1, b: 'two' });
    expect(props.type).toBe('application/ld+json');
    expect(JSON.parse(props.dangerouslySetInnerHTML.__html)).toEqual({ a: 1, b: 'two' });
  });

  // A raw `</script>` inside the JSON string would close the surrounding
  // script tag early — this is the same escaping app/page.tsx already relies
  // on for its FinancialProduct block.
  it('escapes "<" so an embedded "</script>" cannot close the tag early', () => {
    const props = jsonLdScriptProps({ name: '</script><script>alert(1)</script>' });
    expect(props.dangerouslySetInnerHTML.__html).not.toContain('</script>');
    expect(props.dangerouslySetInnerHTML.__html).toContain('\\u003c/script>');
    expect(JSON.parse(props.dangerouslySetInnerHTML.__html)).toEqual({
      name: '</script><script>alert(1)</script>',
    });
  });
});
