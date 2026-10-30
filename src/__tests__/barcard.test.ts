import { describe, expect, test } from 'vitest'
import { blurClosesCard } from '../ui'

const el = (inCard: boolean) => ({ closest: (sel: string) => (inCard && sel === '[data-bar-card]' ? {} : null) }) as unknown as EventTarget

describe('карточка смены и потеря фокуса', () => {
  test('Safari/iOS: клик по кнопке без фокуса (relatedTarget = null) не закрывает карточку', () => {
    expect(blurClosesCard(null)).toBe(false)
  })
  test('фокус перешёл на кнопку внутри карточки — не закрываем', () => {
    expect(blurClosesCard(el(true))).toBe(false)
  })
  test('Tab на другой элемент вне карточки — закрываем', () => {
    expect(blurClosesCard(el(false))).toBe(true)
  })
})
