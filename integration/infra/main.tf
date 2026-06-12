###############################################################################
# Regression diff engine — Milestone 2 integration layer
#   GET /regressions -> diff Lambda -> reads shared ScanResults table
#                                   -> SNS alert on HIGH-severity regression
# All Infrastructure as Code. Uses the pre-made LabRole (no IAM creation).
###############################################################################

# 1. Zip the diff Lambda source at apply time (AWS SDK is in the Node 22 runtime).
data "archive_file" "diff_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../src/diff"
  output_path = "${path.module}/build/diff_lambda.zip"
}

# 2. SNS topic + email subscription for HIGH-severity regression alerts (feedback #5).
#    NOTE: the email subscription must be CONFIRMED via the link AWS emails you.
resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic_subscription" "email_2" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email_2
}

# 3. CloudWatch log group for the diff Lambda.
resource "aws_cloudwatch_log_group" "diff" {
  name              = "/aws/lambda/${var.project_name}-diff"
  retention_in_days = var.log_retention_days
}

# 4. The diff Lambda. Reads the shared table, computes regressions, alerts.
resource "aws_lambda_function" "diff" {
  function_name = "${var.project_name}-diff"
  role          = var.lab_role_arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.diff_zip.output_path
  source_code_hash = data.archive_file.diff_zip.output_base64sha256

  environment {
    variables = {
      TABLE_NAME      = var.scan_results_table
      ALERT_TOPIC_ARN = aws_sns_topic.alerts.arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.diff]
}

# 5. API Gateway (HTTP API) — public GET /regressions front door.
resource "aws_apigatewayv2_api" "http" {
  name          = "${var.project_name}-diff-api"
  protocol_type = "HTTP"
  description   = "Regression diff engine endpoint"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "OPTIONS"]
    allow_headers = ["Content-Type"]
  }
}

resource "aws_apigatewayv2_integration" "diff" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.diff.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "regressions" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /regressions"
  target    = "integrations/${aws_apigatewayv2_integration.diff.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.diff.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
