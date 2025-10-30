# ShadCN Form Implementation Guide

This guide demonstrates proper ShadCN form implementation using `@tanstack/react-form` with the October 2025 component suite (Field, InputGroup, etc.).

## Overview

ShadCN forms combine:
- **Field components** for semantic structure and accessibility
- **InputGroup components** for enhanced input styling
- **@tanstack/react-form** for form management and validation

## Complete Form Example

```tsx
import { useForm } from '@tanstack/react-form';
import { useMutation } from 'convex/react';
import { MapPin, Phone, X } from 'lucide-react';
import { useId, useState } from 'react';

// Import ShadCN components
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupIcon,
  InputGroupInput,
} from '~/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { Spinner } from '~/components/ui/spinner';
import { usePhoneFormatter } from '~/hooks/use-phone-formatter';

interface FormData {
  agentType: 'individual' | 'business';
  agentName: string;
  agentTitle: string;
  agentEntityNumber: string;
  agentMailingAddress: string;
  agentMailingCity: string;
  agentMailingState: string;
  agentMailingZipCode: string;
  agentPhoneNumber: string;
  agentEmailAddress: string;
}

export function ExampleForm({ applicationId }: { applicationId: string }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const phoneFormatter = usePhoneFormatter();

  // Generate unique IDs for form fields
  const agentNameId = useId();
  const agentTitleId = useId();
  const agentEntityNumberId = useId();
  const agentMailingAddressId = useId();
  const agentMailingCityId = useId();
  const agentMailingStateId = useId();
  const agentMailingZipCodeId = useId();
  const agentPhoneNumberId = useId();
  const agentEmailAddressId = useId();

  const form = useForm({
    defaultValues: {
      agentType: 'individual' as 'individual' | 'business',
      agentName: '',
      agentTitle: '',
      agentEntityNumber: '',
      agentMailingAddress: '',
      agentMailingCity: '',
      agentMailingState: '',
      agentMailingZipCode: '',
      agentPhoneNumber: '',
      agentEmailAddress: '',
    },
    onSubmit: async ({ value }) => {
      setErrorMessage(null);
      // Handle form submission
      mutation.mutate(value);
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      // Server function call
      return await serverFunction({ data });
    },
    onSuccess: (result) => {
      // Reset form
      form.reset();

      // Handle success
      console.log('Form submitted successfully', result);
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Submission failed');
    },
  });

  const [agentType, setAgentType] = useState<'individual' | 'business'>('individual');
  const isBusiness = agentType === 'business';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      {/* 1. SELECT FIELD WITH FIELD COMPONENT */}
      <form.Field name="agentType">
        {(field) => (
          <Field>
            <FieldLabel>Agent Type</FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={(value) => {
                const typedValue = value as 'individual' | 'business';
                field.handleChange(typedValue);
                setAgentType(typedValue);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select agent type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual</SelectItem>
                <SelectItem value="business">Business/Entity</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>

      {/* 2. SIMPLE INPUT WITH FIELD COMPONENT */}
      <form.Field name="agentName">
        {(field) => (
          <Field>
            <FieldLabel>
              {isBusiness ? 'Business/Entity Name' : 'Agent Full Name'}
            </FieldLabel>
            <Input
              id={agentNameId}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={
                isBusiness ? 'Enter business or entity name' : 'Enter agent full name'
              }
              required
            />
          </Field>
        )}
      </form.Field>

      {/* 3. CONDITIONAL FIELDS */}
      {isBusiness && (
        <>
          <form.Field name="agentTitle">
            {(field) => (
              <Field>
                <FieldLabel>Name and Title of Signatory</FieldLabel>
                <Input
                  id={agentTitleId}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="e.g., John Doe, CEO"
                  required={isBusiness}
                />
              </Field>
            )}
          </form.Field>
        </>
      )}

      {/* 4. INPUT GROUP WITH ICON (LEFT POSITION) */}
      <form.Field name="agentMailingAddress">
        {(field) => (
          <Field>
            <FieldLabel>Mailing Address</FieldLabel>
            <InputGroup>
              <InputGroupIcon>
                <MapPin />
              </InputGroupIcon>
              <InputGroupInput
                id={agentMailingAddressId}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Street address"
                required
              />
            </InputGroup>
          </Field>
        )}
      </form.Field>

      {/* 5. GRID LAYOUT WITH FIELD COMPONENTS */}
      <div className="grid grid-cols-6 gap-4">
        <form.Field name="agentMailingCity">
          {(field) => (
            <Field orientation="vertical" className="col-span-3">
              <Input
                id={agentMailingCityId}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="City"
                required
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="agentMailingState">
          {(field) => (
            <Field orientation="vertical" className="col-span-1">
              <Input
                id={agentMailingStateId}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="CA"
                maxLength={2}
                required
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="agentMailingZipCode">
          {(field) => (
            <Field orientation="vertical" className="col-span-2">
              <Input
                id={agentMailingZipCodeId}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="ZIP Code"
                required
              />
            </Field>
          )}
        </form.Field>
      </div>

      {/* 6. INPUT GROUP WITH ICON AND INTERACTIVE ADDON */}
      <form.Field name="agentPhoneNumber">
        {(field) => (
          <Field>
            <FieldLabel>Phone Number</FieldLabel>
            <InputGroup>
              <InputGroupIcon>
                <Phone />
              </InputGroupIcon>
              <InputGroupInput
                id={agentPhoneNumberId}
                type="tel"
                value={field.state.value}
                onChange={(e) => {
                  const formatted = phoneFormatter.handleChange(e.target.value);
                  field.handleChange(formatted);
                }}
                placeholder="(123) 456-7890"
                required
              />
              {field.state.value && (
                <InputGroupAddon>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 hover:bg-transparent"
                    onClick={() => field.handleChange('')}
                    aria-label="Clear phone number"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </InputGroupAddon>
              )}
            </InputGroup>
          </Field>
        )}
      </form.Field>

      {/* ERROR HANDLING */}
      {errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* SUBMIT BUTTON */}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={() => {/* handle cancel */}}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <>
              <Spinner className="mr-2" />
              Submitting...
            </>
          ) : (
            'Submit'
          )}
        </Button>
      </div>
    </form>
  );
}
```

## Key Patterns

### 1. **Field Component Structure**
```tsx
<Field>
  <FieldLabel>Label Text</FieldLabel>
  {/* Input, Select, or InputGroup */}
  <InputGroupInput />
</Field>
```

### 2. **Input Group Variations**

#### Icon on Left:
```tsx
<InputGroup>
  <InputGroupIcon><Icon /></InputGroupIcon>
  <InputGroupInput />
</InputGroup>
```

#### Icon on Right:
```tsx
<InputGroup>
  <InputGroupInput />
  <InputGroupAddon><Icon /></InputGroupAddon>
</InputGroup>
```

#### Icon + Interactive Button:
```tsx
<InputGroup>
  <InputGroupIcon><Icon /></InputGroupIcon>
  <InputGroupInput />
  <InputGroupAddon>
    <Button>Action</Button>
  </InputGroupAddon>
</InputGroup>
```

### 3. **Grid Layout Fields**
```tsx
<Field orientation="vertical" className="col-span-3">
  {/* No FieldLabel needed for grid layouts */}
  <Input />
</Field>
```

### 4. **Conditional Fields**
```tsx
{condition && (
  <form.Field name="fieldName">
    {(field) => (
      <Field>
        <FieldLabel>Label</FieldLabel>
        <Input />
      </Field>
    )}
  </form.Field>
)}
```

### 5. **Form State Management**
```tsx
const form = useForm({
  defaultValues: { /* initial values */ },
  onSubmit: async ({ value }) => {
    mutation.mutate(value);
  },
});
```

### 6. **Unique IDs for Accessibility**
```tsx
const fieldId = useId();
// Use in both label (htmlFor) and input (id)
```

### 7. **Mutation with Query Invalidation**
```tsx
const mutation = useMutation({
  mutationFn: async (data) => serverFunction({ data }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.list() });
    form.reset();
  },
});
```

## Best Practices

### ✅ Do's:
- Use `Field` components for semantic structure
- Use `InputGroupInput` within `InputGroup`
- Generate unique IDs with `useId()`
- Handle loading states with `Spinner`
- Use proper form validation
- Invalidate queries on success
- Reset form after successful submission

### ❌ Don'ts:
- Don't mix regular `Input` with `InputGroup` - use `InputGroupInput`
- Don't forget `orientation="vertical"` for grid layouts
- Don't skip unique IDs for accessibility
- Don't forget to handle loading states
- Don't use `FieldDescription` unless truly necessary (keeps forms clean)

## Component Usage Reference

| Component | Purpose | When to Use |
|-----------|---------|-------------|
| `Field` | Semantic form field wrapper | All form fields |
| `FieldLabel` | Accessible label | All form fields except grid layouts |
| `Input` | Simple input | Single inputs without icons/addons |
| `InputGroup` | Enhanced input container | Inputs with icons or buttons |
| `InputGroupInput` | Input within InputGroup | Always with InputGroup |
| `InputGroupIcon` | Icon positioning (left) | Visual context |
| `InputGroupAddon` | Button/icon (right) | Actions, validation, etc. |
| `Select` | Dropdown selection | Predefined options |

This implementation provides accessible, maintainable, and visually consistent forms using the latest ShadCN component patterns.
