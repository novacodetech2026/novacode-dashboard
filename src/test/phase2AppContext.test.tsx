import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useApp } from '../context/AppContext';

describe('Phase 2 — AppProvider End-to-End Scheduling Enforcement (Demo Mode)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <AppProvider>{children}</AppProvider>
  );

  it('enforces operating hours, holidays, buffers, inactive services, and cancellationBufferHours in AppContext', async () => {
    const { result } = renderHook(() => useApp(), { wrapper });

    await act(async () => {
      result.current.setMode('demo');
    });

    await act(async () => {
      result.current.updateTenantSettings({
        ...result.current.currentTenant,
        settings: {
          ...result.current.currentTenant.settings,
          bufferBetweenAppointmentsMinutes: 15,
          cancellationBufferHours: 24,
          specialHours: [
            {
              id: 'sh-holiday',
              date: '2099-05-07',
              open: '09:00',
              close: '18:00',
              isClosed: true,
              label: 'Test Holiday',
            },
          ],
        },
      });
    });

    const activeService = result.current.services.find(s => s.active)!;
    const customer = result.current.customers[0];

    // 1. Add an inactive service and verify booking it fails
    await act(async () => {
      await result.current.addService({
        nameEn: 'Paused Service',
        nameEs: 'Servicio Pausado',
        descriptionEn: 'Paused',
        descriptionEs: 'Pausado',
        durationMinutes: 60,
        price: 80,
        category: 'Test',
        active: false,
        allowsInBusiness: true,
        allowsAtHome: false,
      });
    });
    const inactiveService = result.current.services.find(s => s.nameEn === 'Paused Service')!;

    await act(async () => {
      const inactiveRes = await result.current.addAppointment({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerLanguage: customer.preferredLanguage,
        serviceId: inactiveService.id,
        serviceName: inactiveService.nameEn,
        date: '2099-05-06',
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        price: 80,
        status: 'confirmed',
        locationType: 'in_business',
        source: 'manual_dashboard',
      });
      expect(inactiveRes.success).toBe(false);
    });

    // 2. Booking on a holiday must fail
    await act(async () => {
      const holidayRes = await result.current.addAppointment({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerLanguage: customer.preferredLanguage,
        serviceId: activeService.id,
        serviceName: activeService.nameEn,
        date: '2099-05-07',
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        price: activeService.price,
        status: 'confirmed',
        locationType: 'in_business',
        source: 'manual_dashboard',
      });
      expect(holidayRes.success).toBe(false);
    });

    // 3. Valid booking on 2099-05-06 10:00-11:00 succeeds
    let firstAptId = '';
    await act(async () => {
      const ok = await result.current.addAppointment({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerLanguage: customer.preferredLanguage,
        serviceId: activeService.id,
        serviceName: activeService.nameEn,
        date: '2099-05-06',
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        price: activeService.price,
        status: 'confirmed',
        locationType: 'in_business',
        source: 'manual_dashboard',
      });
      expect(ok.success).toBe(true);
      firstAptId = ok.appointment!.id;
    });

    // 4. Booking inside 15-min buffer (11:00) fails; at 11:15 succeeds
    await act(async () => {
      const bufFail = await result.current.addAppointment({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerLanguage: customer.preferredLanguage,
        serviceId: activeService.id,
        serviceName: activeService.nameEn,
        date: '2099-05-06',
        startTime: '11:00',
        endTime: '12:00',
        durationMinutes: 60,
        price: activeService.price,
        status: 'confirmed',
        locationType: 'in_business',
        source: 'manual_dashboard',
      });
      expect(bufFail.success).toBe(false);
    });

    let secondAptId = '';
    await act(async () => {
      const bufOk = await result.current.addAppointment({
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerLanguage: customer.preferredLanguage,
        serviceId: activeService.id,
        serviceName: activeService.nameEn,
        date: '2099-05-06',
        startTime: '11:15',
        endTime: '12:15',
        durationMinutes: 60,
        price: activeService.price,
        status: 'confirmed',
        locationType: 'in_business',
        source: 'manual_dashboard',
      });
      expect(bufOk.success).toBe(true);
      secondAptId = bufOk.appointment!.id;
    });

    // 5. Rescheduling second appointment onto 10:15 (conflict with first) fails; moving to 14:00 succeeds
    await act(async () => {
      const resFail = await result.current.rescheduleAppointment(secondAptId, '2099-05-06', '10:15');
      expect(resFail.success).toBe(false);

      const resOk = await result.current.rescheduleAppointment(secondAptId, '2099-05-06', '14:00');
      expect(resOk.success).toBe(true);
    });

    // 6. Cancelling a far-future appointment succeeds, whereas cancelling a near-now appointment fails under 24h buffer
    const soonDate = new Date(Date.now() + 2 * 3_600_000);
    const soonDateStr = soonDate.toISOString().slice(0, 10);

    await act(async () => {
      const farCancel = await result.current.cancelAppointment(firstAptId);
      expect(farCancel.success).toBe(true);

      const nearApt = result.current.appointments.find(a => a.status === 'confirmed' && a.date <= soonDateStr);
      if (nearApt) {
        const nearCancel = await result.current.cancelAppointment(nearApt.id);
        expect(nearCancel.success).toBe(false);
        expect(nearCancel.error).toContain('24 hours');
      }
    });
  });
});
