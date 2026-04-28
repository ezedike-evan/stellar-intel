import { renderHook, act } from "@testing-library/react";
import { useAnchorAuth } from "../hooks/useAnchorAuth";

global.fetch = jest.fn();

describe("useAnchorAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("authenticates and stores jwt", async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ jwt: "test-token" }),
    });

    const { result } = renderHook(() => useAnchorAuth());

    await act(async () => {
      await result.current.authenticate("https://anchor.com");
    });

    expect(result.current.jwt).toBe("test-token");
    expect(result.current.isAuthenticating).toBe(false);
  });

  it("handles errors", async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
    });

    const { result } = renderHook(() => useAnchorAuth());

    await act(async () => {
      await result.current.authenticate("https://anchor.com");
    });

    expect(result.current.error).toBeTruthy();
  });

  it("uses cache on second call", async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ jwt: "cached-token" }),
    });

    const { result } = renderHook(() => useAnchorAuth());

    await act(async () => {
      await result.current.authenticate("https://anchor.com");
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.authenticate("https://anchor.com");
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
