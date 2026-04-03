declare module '@himadajin/vscode-components' {
  import * as React from 'react';

  export interface ButtonProps
    extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
    children: React.ReactNode;
    variant?: 'primary' | 'secondary';
    disabled?: boolean;
    icon?: string;
    iconAfter?: string;
    type?: 'button' | 'submit' | 'reset';
    onClick?: () => void;
  }

  export const Button: React.ForwardRefExoticComponent<
    ButtonProps & React.RefAttributes<HTMLButtonElement>
  >;

  export interface CheckboxProps
    extends Omit<React.HTMLAttributes<HTMLElement>, 'onChange'> {
    checked?: boolean;
    defaultChecked?: boolean;
    disabled?: boolean;
    indeterminate?: boolean;
    toggle?: boolean;
    label?: React.ReactNode;
    onChange?: (checked: boolean) => void;
  }

  export const Checkbox: React.ForwardRefExoticComponent<
    CheckboxProps & React.RefAttributes<HTMLElement>
  >;

  export interface DividerProps extends React.HTMLAttributes<HTMLElement> {
    role?: 'separator' | 'presentation';
  }

  export const Divider: React.ForwardRefExoticComponent<
    DividerProps & React.RefAttributes<HTMLElement>
  >;

  export type FormContainerProps = React.HTMLAttributes<HTMLDivElement>;

  export function FormContainer(
    props: FormContainerProps,
  ): React.JSX.Element;

  export interface FormGroupProps extends React.HTMLAttributes<HTMLElement> {
    label: React.ReactNode;
    category?: React.ReactNode;
    description?: React.ReactNode;
    helper?: React.ReactNode;
    children: React.ReactNode;
    modified?: boolean;
    controlId?: string;
    fill?: boolean;
  }

  export function FormGroup(props: FormGroupProps): React.JSX.Element;

  export interface ListEditorProps<T = string> {
    value: T[];
    itemSchema?: unknown;
    onChange: (value: T[]) => void;
    onChangeEvent?: (event: unknown) => void;
    reorderable?: boolean;
    addPlaceholder?: string;
  }

  export function ListEditor<T = string>(
    props: ListEditorProps<T>,
  ): React.JSX.Element;

  export interface SelectProps
    extends Omit<React.HTMLAttributes<HTMLElement>, 'defaultValue' | 'onChange'> {
    value?: string;
    defaultValue?: string;
    enum: string[];
    enumDescriptions?: string[];
    enumItemLabels?: string[];
    disabled?: boolean;
    onChange?: (value: string) => void;
  }

  export const Select: React.ForwardRefExoticComponent<
    SelectProps & React.RefAttributes<HTMLElement>
  >;

  export interface TextInputProps
    extends Omit<
      React.InputHTMLAttributes<HTMLInputElement>,
      'defaultValue' | 'onChange'
    > {
    value?: string | number;
    defaultValue?: string | number;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    type?: 'string' | 'number' | 'integer';
    pattern?: string;
    maxLength?: number;
    minLength?: number;
    onChange?: (value: string) => void;
  }

  export const TextInput: React.ForwardRefExoticComponent<
    TextInputProps & React.RefAttributes<HTMLInputElement>
  >;
}
