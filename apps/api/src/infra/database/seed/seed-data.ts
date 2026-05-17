import { NewTenant, NewTenantSettings } from '../schema/tenants'
import { NewService } from '../schema/services'
import { NewAvailabilitySchedule } from '../schema/availability-schedules'

export const SEED_TENANT: NewTenant = {
  id:           '00000000-0000-0000-0000-000000000001',
  name:         'João Silva — Barbearia',
  email:        'joao@barbearia.com',
  passwordHash: '$2b$12$LcYtcx3EBYNnF2.FpYj/m.9T905clyj1e/WJ4B6bNl1/F518d6N9G', // bcrypt hash de "senha123" com custo 12
  slug:         'joao-barbearia',
  bio:          'Barbeiro há 10 anos, especializado em cortes modernos e barba.',
  phone:        '(85) 99999-1234',
}

export const SEED_SETTINGS: NewTenantSettings = {
  id:                         '00000000-0000-0000-0000-000000000002',
  tenantId:                   SEED_TENANT.id!,
  minBookingNoticeHours:      1,
  maxBookingDaysAhead:        30,
  cancellationDeadlineHours:  2,
  appointmentIntervalMinutes: 10,
}

export const SEED_SERVICES: NewService[] = [
  {
    id:              '00000000-0000-0000-0000-000000000003',
    tenantId:        SEED_TENANT.id!,
    name:            'Corte masculino',
    description:     'Corte tradicional ou moderno com acabamento premium.',
    durationMinutes: 30,
    priceCents:      4500,
  },
  {
    id:              '00000000-0000-0000-0000-000000000004',
    tenantId:        SEED_TENANT.id!,
    name:            'Barba',
    description:     'Alinhamento e corte de barba com toalha quente.',
    durationMinutes: 20,
    priceCents:      3000,
  },
  {
    id:              '00000000-0000-0000-0000-000000000005',
    tenantId:        SEED_TENANT.id!,
    name:            'Corte + Barba',
    description:     'Combo completo: corte e barba com desconto.',
    durationMinutes: 50,
    priceCents:      6500,
  },
  {
    id:              '00000000-0000-0000-0000-000000000006',
    tenantId:        SEED_TENANT.id!,
    name:            'Hidratação capilar',
    description:     'Tratamento capilar completo para fios danificados.',
    durationMinutes: 40,
    priceCents:      5000,
    deletedAt:       new Date('2026-05-15T12:00:00.000Z'),
  },
]

export const SEED_SCHEDULES: NewAvailabilitySchedule[] = [
  // Segunda a Sexta: 09h–12h e 14h–18h
  ...[1, 2, 3, 4, 5].flatMap((day, index): NewAvailabilitySchedule[] => [
    {
      id:        `00000000-0000-0000-0000-0000000000${10 + index * 2 + 1}`,
      tenantId:  SEED_TENANT.id!,
      dayOfWeek: day,
      startTime: '09:00',
      endTime:   '12:00',
    },
    {
      id:        `00000000-0000-0000-0000-0000000000${10 + index * 2 + 2}`,
      tenantId:  SEED_TENANT.id!,
      dayOfWeek: day,
      startTime: '14:00',
      endTime:   '18:00',
    },
  ]),
  // Sábado: 09h–13h
  {
    id:        '00000000-0000-0000-0000-000000000021',
    tenantId:  SEED_TENANT.id!,
    dayOfWeek: 6,
    startTime: '09:00',
    endTime:   '13:00',
  },
]
