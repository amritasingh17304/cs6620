variable "region" {
  description = "AWS region (Learner Lab is us-east-1)."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix for all resource names."
  type        = string
  default     = "sast-tracker"
}

variable "lab_role_arn" {
  description = <<-EOT
    ARN of the pre-created Learner Lab execution role (we cannot create IAM roles).
    Get it with:  aws iam get-role --role-name LabRole --query Role.Arn --output text
  EOT
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the Lambda."
  type        = number
  default     = 7
}
