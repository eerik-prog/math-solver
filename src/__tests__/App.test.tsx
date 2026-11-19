// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { solve } from '../engine'

// The real client runs the engine in a Web Worker; jsdom has none, so solve inline.
vi.mock('../solverClient', () => ({
  SolverClient: class {
    solve(input: string) {
      return Promise.resolve(solve(input))
    }
  },
}))

const { default: App } = await import('../App')

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(cleanup)

describe('App', () => {
  it('solves a typed problem and shows answers and steps', async () => {
    render(<App />)
    const input = screen.getByLabelText('Math problem')
    await userEvent.type(input, '2x + 3 = 11')
    fireEvent.submit(input.closest('form')!)
    expect(await screen.findByText('Solve for x')).toBeInTheDocument()
    expect(screen.getByText('Step-by-step')).toBeInTheDocument()
    expect(screen.getByText(/^Subtract 3 from both sides/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy x = 4' })).toBeInTheDocument()
  })

  it('remembers solved problems and puts them in the URL', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'x^2 - 5x + 6 = 0' }))
    await screen.findByText('Solve for x')
    expect(window.location.search).toContain('q=')
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('math-solver:history') ?? '[]')).toContain('x^2 - 5x + 6 = 0'),
    )
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeInTheDocument()
  })

  it('shows a friendly error for invalid input', async () => {
    render(<App />)
    const input = screen.getByLabelText('Math problem')
    await userEvent.type(input, '2x + (3')
    fireEvent.submit(input.closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent(/parenthes/i)
  })

  it('inserts symbols from the keypad at the cursor', async () => {
    render(<App />)
    const input = screen.getByLabelText('Math problem') as HTMLInputElement
    await userEvent.type(input, 'x')
    await userEvent.click(screen.getByTitle('Square'))
    expect(input.value).toBe('x^2')
    await userEvent.click(screen.getByTitle('Square root'))
    expect(input.value).toBe('x^2sqrt()')
    await userEvent.clear(input)
    await userEvent.type(input, '2')
    await userEvent.click(screen.getByTitle('Times'))
    await userEvent.type(input, '3')
    await userEvent.click(screen.getByTitle('Plus'))
    await userEvent.type(input, '4')
    await userEvent.click(screen.getByTitle('Minus'))
    await userEvent.type(input, '1')
    expect(input.value).toBe('2*3 + 4 - 1')
  })

  it('cycles the colour theme and remembers it', async () => {
    render(<App />)
    const toggle = screen.getByRole('button', { name: /Theme: auto/ })
    await userEvent.click(toggle)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    await userEvent.click(screen.getByRole('button', { name: /Theme: dark/ }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('math-solver:theme')).toBe('light')
    await userEvent.click(screen.getByRole('button', { name: /Theme: light/ }))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('loads the problem from the URL', async () => {
    window.history.replaceState(null, '', '/?q=' + encodeURIComponent('factor 360'))
    render(<App />)
    expect(await screen.findByText('Prime factorization')).toBeInTheDocument()
  })
})
