import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RateTable } from '@/components/offramp/RateTable'
import type { RateComparison, AnchorRate } from '@/types'

const makeRate = (anchorId: string, totalReceived: number): AnchorRate => ({
  anchorId,
  anchorName: anchorId === 'cowrie' ? 'Cowrie' : 'Flutterwave',
  corridorId: 'usdc-ngn',
  fee: 2,
  feeType: 'flat',
  exchangeRate: 1580,
  totalReceived,
  updatedAt: new Date(),
})

const mockRates: RateComparison = {
  corridorId: 'usdc-ngn',
  bestRateId: 'cowrie',
  rates: [makeRate('cowrie', 154840), makeRate('flutterwave', 153260)],
}

describe('RateTable', () => {
  it('renders three skeleton rows when isLoading is true', () => {
    const { container } = render(
      <RateTable rates={undefined} isLoading={true} error={undefined} onSelectAnchor={vi.fn()} />
    )
    const animatedDivs = container.querySelectorAll('.animate-pulse')
    expect(animatedDivs.length).toBe(15) // 3 rows × 5 cells each
  })

  it('renders the correct number of data rows from a RateComparison with two anchors', () => {
    render(
      <RateTable rates={mockRates} isLoading={false} error={undefined} onSelectAnchor={vi.fn()} />
    )
    const buttons = screen.getAllByRole('button', { name: 'Off-ramp' })
    expect(buttons).toHaveLength(2)
  })

  it('the best rate row includes the "Best Rate" badge', () => {
    render(
      <RateTable rates={mockRates} isLoading={false} error={undefined} onSelectAnchor={vi.fn()} />
    )
    expect(screen.getByText('Best Rate')).toBeInTheDocument()
  })

  it('the error state renders the error message string', () => {
    render(
      <RateTable
        rates={undefined}
        isLoading={false}
        error="Failed to fetch rates"
        onSelectAnchor={vi.fn()}
      />
    )
    expect(screen.getByText('Failed to fetch rates')).toBeInTheDocument()
  })

  it('clicking the "Off-ramp" button calls onSelectAnchor with the correct AnchorRate', () => {
    const onSelectAnchor = vi.fn()
    render(
      <RateTable rates={mockRates} isLoading={false} error={undefined} onSelectAnchor={onSelectAnchor} />
    )
    const buttons = screen.getAllByRole('button', { name: 'Off-ramp' })
    fireEvent.click(buttons[0])
    expect(onSelectAnchor).toHaveBeenCalledWith(mockRates.rates[0])
  })

  it('renders the empty state message when rates array is empty', () => {
    const emptyRates: RateComparison = { ...mockRates, rates: [], bestRateId: '' }
    render(
      <RateTable rates={emptyRates} isLoading={false} error={undefined} onSelectAnchor={vi.fn()} />
    )
    expect(screen.getByText('No rates available for this corridor.')).toBeInTheDocument()
  })
})
