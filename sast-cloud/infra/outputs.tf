output "scan_endpoint" {
  description = "Public URL to POST code to (your SAST front door)."
  value       = "${aws_apigatewayv2_api.http.api_endpoint}/scan"
}

output "scan_results_table" {
  description = "DynamoDB table holding scan findings."
  value       = aws_dynamodb_table.scan_results.name
}

output "environments_table" {
  description = "DynamoDB table for registered environments."
  value       = aws_dynamodb_table.environments.name
}

output "lambda_name" {
  description = "Lambda function name (for CloudWatch logs)."
  value       = aws_lambda_function.sast.function_name
}

output "log_group" {
  description = "CloudWatch log group for the Lambda."
  value       = aws_cloudwatch_log_group.sast.name
}
