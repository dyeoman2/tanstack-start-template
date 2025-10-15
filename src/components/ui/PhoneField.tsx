import { X } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Field, FieldLabel } from '~/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupIcon,
  InputGroupInput,
} from '~/components/ui/input-group';
import { usePhoneFormatter } from '~/hooks/use-phone-formatter';

interface PhoneFieldProps {
  name: string;
  id?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  showClearButton?: boolean;
  value?: string;
  onChange?: (value: string) => void;
}

export function PhoneField({
  name,
  id,
  label = 'Phone Number',
  placeholder = '(123) 456-7890',
  required = false,
  disabled = false,
  showClearButton = true,
  value,
  onChange,
}: PhoneFieldProps) {
  const phoneFormatter = usePhoneFormatter(value);

  const handleChange = (inputValue: string) => {
    const formatted = phoneFormatter.formatInput(inputValue);
    phoneFormatter.setValue(formatted);
    onChange?.(formatted);
  };

  const currentValue = value !== undefined ? value : phoneFormatter.value;

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <InputGroup>
        <InputGroupIcon>
          <span className="text-sm">📞</span>
        </InputGroupIcon>
        <InputGroupInput
          id={id || name}
          name={name}
          type="tel"
          value={currentValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
        />
        {showClearButton && currentValue && (
          <InputGroupAddon>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-card"
              onClick={() => handleChange('')}
              aria-label="Clear phone number"
            >
              <X className="h-3 w-3" />
            </Button>
          </InputGroupAddon>
        )}
      </InputGroup>
    </Field>
  );
}
