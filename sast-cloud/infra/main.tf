###############################################################################
# SAST pipeline — Milestone 1 (Ramandeep, CS6620 Group 18)
#   Client --HTTPS POST--> API Gateway (HTTP API) --> SAST Lambda --> DynamoDB
#                                                          |
#                                                          +--> CloudWatch Logs
# Everything below is Infrastructure as Code (answers proposal feedback #1).
###############################################################################

# ---------------------------------------------------------------------------
# 1. Package the Lambda code. Terraform zips src/sast at plan/apply time.
#    AWS SDK v3 ships with the Node 22 runtime, so we don't bundle node_modules.
# ---------------------------------------------------------------------------
data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../src/sast"
  output_path = "${path.module}/build/sast_lambda.zip"
}

# ---------------------------------------------------------------------------
# 2. DynamoDB — ScanResults table (proposal feedback #7 schema).
#    PK jobId, SK envScanType ("env#scanType", e.g. "dev#SAST").
#    PAY_PER_REQUEST = no idle cost, well within the $50 budget.
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "scan_results" {
  name         = "${var.project_name}-ScanResults"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"
  range_key    = "envScanType"

  attribute {
    name = "jobId"
    type = "S"
  }
  attribute {
    name = "envScanType"
    type = "S"
  }

  tags = {
    Project   = var.project_name
    Owner     = "Ramandeep"
    Milestone = "1"
  }
}

# Environments table (PK envId) — lets a developer "register" dev/staging/prod.
# Included to fully implement the feedback #7 schema and set up the M2 diff.
resource "aws_dynamodb_table" "environments" {
  name         = "${var.project_name}-Environments"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "envId"

  attribute {
    name = "envId"
    type = "S"
  }

  tags = {
    Project   = var.project_name
    Owner     = "Ramandeep"
    Milestone = "1"
  }
}

# ---------------------------------------------------------------------------
# 3. CloudWatch Log Group for the Lambda (proposal feedback #6 monitoring).
#    Created explicitly so we control retention instead of an unbounded group.
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "sast" {
  name              = "/aws/lambda/${var.project_name}-scanner"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------------------
# 4. The SAST Lambda. Uses the pre-made LabRole (we cannot create IAM roles).
# ---------------------------------------------------------------------------
resource "aws_lambda_function" "sast" {
  function_name = "${var.project_name}-scanner"
  role          = var.lab_role_arn
  runtime       = "nodejs22.x"
  handler       = "index.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.scan_results.name
    }
  }

  # Make sure the log group exists first so logs land in our retained group.
  depends_on = [aws_cloudwatch_log_group.sast]

  tags = {
    Project   = var.project_name
    Owner     = "Ramandeep"
    Milestone = "1"
  }
}

# ---------------------------------------------------------------------------
# 5. API Gateway (HTTP API) — the public "front door" (replaces Express server).
# ---------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "http" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"
  description   = "Public front door for the SAST scanner"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["Content-Type"]
  }
}

resource "aws_apigatewayv2_integration" "sast" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sast.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "scan" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /scan"
  target    = "integrations/${aws_apigatewayv2_integration.sast.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

# Allow API Gateway to invoke the Lambda.
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sast.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
