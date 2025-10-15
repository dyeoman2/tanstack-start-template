import { Mail } from 'lucide-react';
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '~/components/ui/input-group';
import { PhoneField } from './PhoneField';

interface ContactFieldsProps {
  prefix?: string; // For field names like agentName, ownerName
  includePhone?: boolean;
  includeEmail?: boolean;
  required?: boolean;
  disabled?: boolean;
  phoneValue?: string;
  emailValue?: string;
  onPhoneChange?: (value: string) => void;
  onEmailChange?: (value: string) => void;
}

export function ContactFields({
  prefix = '',
  includePhone = true,
  includeEmail = true,
  required = false,
  disabled = false,
  phoneValue,
  emailValue,
  onPhoneChange,
  onEmailChange,
}: ContactFieldsProps) {
  const nameField = prefix ? `${prefix}Name` : 'name';
  const phoneField = prefix ? `${prefix}PhoneNumber` : 'phoneNumber';
  const emailField = prefix ? `${prefix}EmailAddress` : 'emailAddress';

  return (
    <>
      {/* Name */}
      <Field>
        <FieldLabel>Name</FieldLabel>
        <Input
          id={nameField}
          name={nameField}
          placeholder="Full name"
          required={required}
          disabled={disabled}
        />
      </Field>

      {/* Phone Number */}
      {includePhone && (
        <PhoneField
          name={phoneField}
          required={required}
          disabled={disabled}
          value={phoneValue}
          onChange={onPhoneChange}
        />
      )}

      {/* Email Address */}
      {includeEmail && (
        <Field>
          <FieldLabel>Email Address</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <Mail />
            </InputGroupAddon>
            <InputGroupInput
              id={emailField}
              name={emailField}
              type="email"
              placeholder="email@example.com"
              required={required}
              disabled={disabled}
              value={emailValue}
              onChange={(e) => onEmailChange?.(e.target.value)}
            />
          </InputGroup>
        </Field>
      )}
    </>
  );
}
