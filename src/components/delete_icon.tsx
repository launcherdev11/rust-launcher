type DeleteIconProps = {
  className?: string;
};

export function DeleteIcon({ className = "h-4 w-4 object-contain" }: DeleteIconProps) {
  return (
    <img
      src="/launcher-assets/delete.png"
      alt=""
      className={className}
      aria-hidden
    />
  );
}
