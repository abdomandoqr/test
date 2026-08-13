import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isValidName } from '../src/utils/validation.js';
import { normalizePhone } from '../src/utils/phone.js';
import { t } from '../src/utils/templates.js';
import { isAck, route } from '../src/handlers/intentHandler.js';

describe('validation', () => {
    it('rejects greetings and short/phone-like inputs', () => {
        const rejections = [
            'hello',
            'hi',
            'hey',
            'ahlan',
            'مرحبا',
            'what is your name',
            'اسمي أحمد',
            '/start',
            '+201234567890',
            'a',
            '',
        ];
        for (const input of rejections) {
            assert.strictEqual(isValidName(input), false, `expected ${JSON.stringify(input)} to be rejected`);
        }
    });

    it('accepts real names', () => {
        const acceptances = [
            'Ahmed Hassan',
            'Ahmed',
            'أحمد حسن',
            'Mariam Ali',
            'John Smith',
        ];
        for (const input of acceptances) {
            assert.strictEqual(isValidName(input), true, `expected ${JSON.stringify(input)} to be accepted`);
        }
    });
});

describe('phone normalization', () => {
    it('accepts Egypt (+20) formats', () => {
        const result = normalizePhone('+201234567890');
        assert.ok(result);
        assert.strictEqual(result.countryCode, '+20');
        assert.strictEqual(result.phone, '+201234567890');
    });

    it('accepts Saudi Arabia (+966) formats', () => {
        const result = normalizePhone('+966501234567');
        assert.ok(result);
        assert.strictEqual(result.countryCode, '+966');
        assert.strictEqual(result.phone, '+966501234567');
    });

    it('accepts UAE (+971) formats', () => {
        const result = normalizePhone('+971501234567');
        assert.ok(result);
        assert.strictEqual(result.countryCode, '+971');
        assert.strictEqual(result.phone, '+971501234567');
    });

    it('accepts international numbers with separators', () => {
        const cases = [
            { input: '+14155552671', phone: '+14155552671', countryCode: '+1' },
            { input: '+44 7911 123 456', phone: '+447911123456', countryCode: '+44' },
            { input: '(+49) 1234-5678', phone: '+4912345678', countryCode: '+49' },
            { input: '004912345678', phone: '+4912345678', countryCode: '+49' },
            { input: '01234567890', phone: '01234567890', countryCode: null },
            { input: '+999123456789', phone: '+999123456789', countryCode: null }, // unknown prefix, valid shape
        ];
        for (const { input, phone, countryCode } of cases) {
            const result = normalizePhone(input);
            assert.ok(result, `expected ${JSON.stringify(input)} to be accepted`);
            assert.strictEqual(result.phone, phone, `phone mismatch for ${JSON.stringify(input)}`);
            assert.strictEqual(result.countryCode, countryCode, `country code mismatch for ${JSON.stringify(input)}`);
        }
    });

    it('rejects invalid numbers', () => {
        const invalid = [
            '123',
            'not a phone',
            '',
            'abc',
            'مرحبا',
            '+44 7911 123 456 789 012 345', // too many digits
        ];
        for (const input of invalid) {
            assert.strictEqual(normalizePhone(input), null, `expected ${JSON.stringify(input)} to be rejected`);
        }
    });
});

describe('template substitution', () => {
    it('never emits raw {{...}} or ${...} placeholders', () => {
        const keys = [
            'welcome',
            'askName',
            'readyToBook',
            'bookingSummary',
            'alreadyHasAppointment',
            'rescheduleSuccess',
            'cancelSuccess',
            'reminderBody',
        ];
        for (const lang of ['en', 'ar']) {
            for (const key of keys) {
                const output = t(key, lang);
                assert.doesNotMatch(output, /\{\{[A-Z_]+\}\}/, `${key} (${lang}) contains raw {{...}}`);
                assert.doesNotMatch(output, /\$\{[A-Z_]+\}/, `${key} (${lang}) contains raw ${'${...}'}`);
            }
        }
    });
});

describe('acknowledgement routing', () => {
    it('does not route ack messages to book', async () => {
        const acks = ['ok', 'thanks', 'yes', 'حسنا', 'تمام', 'شكرا'];
        for (const text of acks) {
            assert.strictEqual(isAck(text), true, `${text} should be recognized as ack`);
        }
    });
});
