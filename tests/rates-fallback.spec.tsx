import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RateTable } from '@/components/offramp/RateTable'
import type { AnchorRate, RateComparison } from '@/types'

const unavailableRate: AnchorRate = {
  anchorId: 'cowrie',
  anchorName: 'Cowrie Exchange',
  corridorId: 'usdc-ngn',
  fee: null,
  feeType: 'flat',
  exchangeRate: null,
  totalReceived: null,
  updatedAt: new Date(),
  source: 'unavailable',
}

const unavailableRates: RateComparison = {
  corridorId: 'usdc-ngn',
  bestRateId: '',
  rates: [unavailableRate],
}

describe('rates-fallback — source: unavailable', () => {
  it('source is "unavailable" and all rate fields are null', () => {
    expect(unavailableRate.source).toBe('unavailable')
    expect(unavailableRate.fee).toBeNull()
    expect(unavailableRate.exchangeRate).toBeNull()
    expect(unavailableRate.totalReceived).toBeNull()
  })

  it('renders "—" for fee, rate, and totalReceived when source is unavailable', () => {
    render(
      <RateTable
        rates={unavailableRates}
        isLoading={false}
        error={undefined}
        onSelectAnchor={vi.fn()}
      />
    )
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })

  it('shows the "Unavailable" badge and no "Best Rate" badge', () => {
    render(
      <RateTable
        rates={unavailableRates}
        isLoading={false}
        error={undefined}
        onSelectAnchor={vi.fn()}
      />
    )
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Best Rate')).not.toBeInTheDocument()
  })

  it('disables the Off-ramp button for unavailable anchors', () => {
    render(
      <RateTable
        rates={unavailableRates}
        isLoading={false}
        error={undefined}
        onSelectAnchor={vi.fn()}
      />
    )
    const button = screen.getByRole('button', { name: 'Off-ramp' })
    expect(button).toBeDisabled()
  })

  it('does not render any numeric rate values for unavailable anchors', () => {
    const { container } = render(
      <RateTable
        rates={unavailableRates}
        isLoading={false}
        error={undefined}
        onSelectAnchor={vi.fn()}
      />
    )
    const cellText = Array.from(container.querySelectorAll('td')).map((td) => td.textContent)
    const hasNumericRate = cellText.some((t) => t !== null && /1 USDC =/.test(t))
    expect(hasNumericRate).toBe(false)
  })
})
