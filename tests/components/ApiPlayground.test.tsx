import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ApiPlayground from '@/components/docs/ApiPlayground';

// #871 — the console hardcoded BASE_URL to production and fired live requests
// at it, including POST /api/intent/offramp. The issue asks for the opposite: a
// try-it console against a sandboxed environment, not production. These tests
// pin that, because it is the one requirement the component was violating.

const SPEC = {
  paths: {
    '/api/rates/{corridor}': {
      get: {
        summary: 'Get rates for a corridor',
        tags: ['Rates'],
        parameters: [{ name: 'corridor', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/intent/offramp': {
      post: {
        summary: 'Submit an off-ramp intent',
        tags: ['Intents'],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { properties: { amount: { type: 'string' } } } },
          },
        },
        responses: { 200: { description: 'OK' } },
      },
    },
  },
  components: { schemas: {} },
};

function stubSpecFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('openapi.json')) {
      return { json: async () => SPEC, ok: true, status: 200, text: async () => '' } as Response;
    }
    return { ok: true, status: 200, text: async () => '{}' } as Response;
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiPlayground (#871)', () => {
  it('defaults to the current origin, not production', async () => {
    stubSpecFetch();
    render(<ApiPlayground />);

    const select = await screen.findByLabelText('Environment');
    expect((select as HTMLSelectElement).value).toBe('sandbox');

    // The visible target must not advertise the production host by default.
    expect(screen.queryByText(/stellar-intel\.vercel\.app/)).not.toBeInTheDocument();
  });

  it('sends a try-it request to the same origin by default', async () => {
    const fetchMock = stubSpecFetch();
    render(<ApiPlayground />);

    await screen.findByLabelText('Environment');
    fireEvent.click(screen.getByText('Submit an off-ramp intent'));
    fireEvent.click(screen.getAllByText('Try it')[0]!);
    fireEvent.click(await screen.findByText('Send Request'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/intent'));
      expect(call, 'no try-it request was sent').toBeDefined();
      // Relative, i.e. same-origin — not the production host.
      expect(String(call![0])).toBe('/api/intent/offramp');
    });
  });

  it('warns before a write request against production', async () => {
    stubSpecFetch();
    render(<ApiPlayground />);

    const select = await screen.findByLabelText('Environment');
    fireEvent.change(select, { target: { value: 'production' } });

    fireEvent.click(screen.getByText('Submit an off-ramp intent'));
    fireEvent.click(screen.getAllByText('Try it')[0]!);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/live POST against production/i);
  });

  it('does not warn for a read request against production', async () => {
    stubSpecFetch();
    render(<ApiPlayground />);

    const select = await screen.findByLabelText('Environment');
    fireEvent.change(select, { target: { value: 'production' } });

    fireEvent.click(screen.getByText('Get rates for a corridor'));
    fireEvent.click(screen.getAllByText('Try it')[0]!);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders path parameters as inputs rather than calling window.prompt', async () => {
    stubSpecFetch();
    const promptSpy = vi.fn();
    vi.stubGlobal('prompt', promptSpy);

    render(<ApiPlayground />);
    await screen.findByLabelText('Environment');

    fireEvent.click(screen.getByText('Get rates for a corridor'));
    fireEvent.click(screen.getAllByText('Try it')[0]!);

    // prompt() is blocked in cross-origin iframes and unusable on mobile.
    const input = await screen.findByLabelText(/Path parameter:\s*corridor/);
    expect((input as HTMLInputElement).value).toBe('usdc-ngn');

    fireEvent.click(screen.getByText('Send Request'));
    await waitFor(() => expect(promptSpy).not.toHaveBeenCalled());
  });

  it('groups endpoints by their first tag', async () => {
    stubSpecFetch();
    render(<ApiPlayground />);

    expect(await screen.findByText('Rates')).toBeInTheDocument();
    expect(screen.getByText('Intents')).toBeInTheDocument();
  });
});
