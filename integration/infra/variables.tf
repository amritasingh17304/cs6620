variable "region" {
  description = "AWS region (Learner Lab is us-east-1)."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix for all resource names (shared platform name)."
  type        = string
  default     = "regression-tracker"
}

variable "lab_role_arn" {
  description = "Pre-created Learner Lab role (we cannot create IAM roles). Reused as the Lambda role."
  type        = string
  default     = "arn:aws:iam::070824440005:role/LabRole"
}

variable "scan_results_table" {
  description = "The shared DynamoDB table the diff engine reads (written to by both SAST and Pentest)."
  type        = string
  default     = "regression-tracker-ScanResults"
}

variable "alert_email" {
  description = "Email subscribed to HIGH-severity regression alerts (must be confirmed via the SNS email)."
  type        = string
  default     = "thakur.amr@northeastern.edu"
}

variable "alert_email_2" {
  description = "Second teammate email for regression alerts (must be confirmed via the SNS email)."
  type        = string
  default     = "lnu.ramande@northeastern.edu"
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the diff Lambda."
  type        = number
  default     = 7
}
