import { MapPin } from 'lucide-react';
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { InputGroup, InputGroupIcon, InputGroupInput } from '~/components/ui/input-group';

interface AddressFieldsProps {
  prefix?: string; // For field names like agentMailingAddress, ownerMailingAddress
  required?: boolean;
  disabled?: boolean;
  label?: string;
  showLabel?: boolean;
}

export function AddressFields({
  prefix = '',
  required = false,
  disabled = false,
  label = 'Mailing Address',
  showLabel = true,
}: AddressFieldsProps) {
  const fieldPrefix = prefix ? `${prefix}Mailing` : 'mailing';

  return (
    <>
      {/* Address */}
      <Field>
        {showLabel && <FieldLabel>{label}</FieldLabel>}
        <InputGroup>
          <InputGroupIcon>
            <MapPin />
          </InputGroupIcon>
          <InputGroupInput
            id={`${fieldPrefix}Address`}
            name={`${fieldPrefix}Address`}
            placeholder="Street address"
            required={required}
            disabled={disabled}
          />
        </InputGroup>
      </Field>

      {/* City, State, ZIP in a grid */}
      <div className="grid grid-cols-6 gap-4">
        <Field orientation="vertical" className="col-span-3">
          <Input
            id={`${fieldPrefix}City`}
            name={`${fieldPrefix}City`}
            placeholder="City"
            required={required}
            disabled={disabled}
          />
        </Field>

        <Field orientation="vertical" className="col-span-1">
          <Input
            id={`${fieldPrefix}State`}
            name={`${fieldPrefix}State`}
            placeholder="State"
            defaultValue="CA"
            maxLength={2}
            required={required}
            disabled={disabled}
          />
        </Field>

        <Field orientation="vertical" className="col-span-2">
          <Input
            id={`${fieldPrefix}ZipCode`}
            name={`${fieldPrefix}ZipCode`}
            placeholder="ZIP Code"
            required={required}
            disabled={disabled}
          />
        </Field>
      </div>
    </>
  );
}
