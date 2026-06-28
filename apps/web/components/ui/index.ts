// App primitives — real shadcn/ui components, re-themed monochrome. Lowercase
// filenames (shadcn convention); the capitalised exports keep the public API stable.
export { Button, buttonVariants } from './button';
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from './card';
export { Badge, badgeVariants } from './badge';
export { Eyebrow } from './Eyebrow';
export { EmptyState } from './EmptyState';
export { PageContainer } from './PageContainer';
export { SectionHeader } from './SectionHeader';
export { Stat } from './Stat';
export { Separator } from './separator';

// Form controls.
export { FormError } from './FormError';
export { Input } from './input';
export { Textarea } from './textarea';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';
export { Label } from './label';

// react-hook-form integration.
export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from './form';
export { TextField, TextareaField, SelectField } from './fields';
