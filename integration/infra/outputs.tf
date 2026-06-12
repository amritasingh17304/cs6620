output "regressions_endpoint" {
  description = "GET this URL to see detected regressions."
  value       = "${aws_apigatewayv2_api.http.api_endpoint}/regressions"
}

output "alert_topic_arn" {
  description = "SNS topic for HIGH-severity regression alerts."
  value       = aws_sns_topic.alerts.arn
}

output "diff_lambda_name" {
  description = "Diff Lambda function name (for CloudWatch logs)."
  value       = aws_lambda_function.diff.function_name
}

output "log_group" {
  description = "CloudWatch log group for the diff Lambda."
  value       = aws_cloudwatch_log_group.diff.name
}
